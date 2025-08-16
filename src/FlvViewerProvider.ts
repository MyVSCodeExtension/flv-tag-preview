
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// --- AMF0 Parsing Utilities ---

class AmfParser {
    private buffer: Buffer;
    private offset: number = 0;

    constructor(buffer: Buffer) {
        this.buffer = buffer;
    }

    private readUi8(): number {
        const value = this.buffer.readUInt8(this.offset);
        this.offset += 1;
        return value;
    }

    private readUi16(): number {
        const value = this.buffer.readUInt16BE(this.offset);
        this.offset += 2;
        return value;
    }

    private readDouble(): number {
        const value = this.buffer.readDoubleBE(this.offset);
        this.offset += 8;
        return value;
    }

    private parseAmfString(): string {
        const length = this.readUi16();
        const value = this.buffer.toString('utf8', this.offset, this.offset + length);
        this.offset += length;
        return value;
    }

    public parseAmfValue(typeMarker?: number): any {
        if (typeMarker === undefined) {
            typeMarker = this.readUi8();
        }

        switch (typeMarker) {
            case 0: // Number
                return this.readDouble();
            case 1: // Boolean
                return this.readUi8() !== 0;
            case 2: // String
                return this.parseAmfString();
            case 3: // Object
                {
                    const obj: { [key: string]: any } = {};
                    while (true) {
                        try {
                            const key = this.parseAmfString();
                            if (!key) break;
                            const valueType = this.readUi8();
                            if (valueType === 9) break; // Object End Marker
                            obj[key] = this.parseAmfValue(valueType);
                        } catch (e) {
                            break; // Reached end of data
                        }
                    }
                    return obj;
                }
            case 8: // ECMA Array
                {
                    const count = this.buffer.readUInt32BE(this.offset);
                    this.offset += 4;
                    const arr: { [key: string]: any } = {};
                    for (let i = 0; i < count; i++) {
                        const key = this.parseAmfString();
                        const value = this.parseAmfValue();
                        arr[key] = value;
                    }
                    this.offset += 3; // Skip object end marker
                    return arr;
                }
            case 10: // Strict Array
                {
                    const count = this.buffer.readUInt32BE(this.offset);
                    this.offset += 4;
                    const arr: any[] = [];
                    for (let i = 0; i < count; i++) {
                        arr.push(this.parseAmfValue());
                    }
                    return arr;
                }
            default:
                return `Unsupported AMF Type: ${typeMarker}`;
        }
    }
}


// --- Interfaces for FLV Structure ---

interface FlvHeader {
    Version: number;
    HasVideo: boolean;
    HasAudio: boolean;
    HeaderSize: number;
}

interface FlvTag {
    offset: number;
    tag_type: number;
    data_size: number;
    timestamp: number;
    stream_id: number;
    total_size: number;
    details: { [key: string]: any };
    analysis: { [key: string]: any };
    get_type_name(): string;
    get_display_info(): { [key: string]: any };
}

const TAG_TYPES = { 8: "Audio", 9: "Video", 18: "Script Data" };
const AUDIO_FORMATS = { 0: "LPCM", 1: "ADPCM", 2: "MP3", 3: "LPCM LE", 4: "Nellymoser 16kHz", 5: "Nellymoser 8kHz", 6: "Nellymoser", 7: "G.711 A-law", 8: "G.711 mu-law", 9: "reserved", 10: "AAC", 11: "Speex", 14: "MP3 8kHz", 15: "Device-specific" };
const VIDEO_FRAME_TYPES = { 1: "Key frame", 2: "Inter frame", 3: "Disposable inter frame", 4: "Generated key frame", 5: "Video info/command frame" };
const VIDEO_CODECS = { 2: "Sorenson H.263", 3: "Screen video", 4: "On2 VP6", 5: "On2 VP6 with alpha", 6: "Screen video v2", 7: "AVC (H.264)" };


class FlvTagImpl implements FlvTag {
    offset: number;
    tag_type: number;
    data_size: number;
    timestamp: number;
    stream_id: number;
    data: Buffer;
    total_size: number;
    details: { [key: string]: any } = {};
    analysis: { [key: string]: any } = {};

    constructor(offset: number, data: Buffer, global_metadata: { [key: string]: any }) {
        this.offset = offset;
        this.tag_type = data[0];
        this.data_size = (data[1] << 16) | (data[2] << 8) | data[3];
        this.timestamp = (data[4] << 16) | (data[5] << 8) | data[6] | (data[7] << 24);
        this.stream_id = (data[8] << 16) | (data[9] << 8) | data[10];
        this.data = data.slice(11, 11 + this.data_size);
        this.total_size = 11 + this.data_size + 4;

        if (this.tag_type === 8) {
            this._parse_audio_data(global_metadata);
        } else if (this.tag_type === 9) {
            this._parse_video_data();
        } else if (this.tag_type === 18) {
            this._parse_script_data();
        }
    }

    private _parse_audio_data(meta: { [key: string]: any }) {
        if (!this.data.length) return;
        const flags = this.data[0];
        const sound_format = flags >> 4;
        this.details["Format"] = AUDIO_FORMATS[sound_format as keyof typeof AUDIO_FORMATS] || `Unknown (${sound_format})`;
        // ... more audio parsing logic from python script
    }

    private _parse_video_data() {
        if (!this.data.length) return;
        const flags = this.data[0];
        const frame_type = (flags >> 4) & 0xF;
        const codec_id = flags & 0xF;
        this.details["Frame Type"] = VIDEO_FRAME_TYPES[frame_type as keyof typeof VIDEO_FRAME_TYPES] || `Unknown (${frame_type})`;
        this.details["Codec ID"] = VIDEO_CODECS[codec_id as keyof typeof VIDEO_CODECS] || `Unknown (${codec_id})`;
        if (codec_id === 7 && this.data.length > 4) { // AVC
            const avc_packet_type = this.data[1];
            const cts = (this.data[2] << 16) | (this.data[3] << 8) | this.data[4];
            this.details["AVC Packet Type"] = { 0: "Seq. header", 1: "NALU", 2: "End of seq." }[avc_packet_type] || "Unknown";
            this.details["CompositionTime Offset"] = `${cts} ms`;
        }
    }

    private _parse_script_data() {
        if (!this.data.length) return;
        try {
            const parser = new AmfParser(this.data);
            const name = parser.parseAmfValue();
            const value = parser.parseAmfValue();
            this.details["Name"] = name;
            if (name === "onMetaData") {
                this.details["Type"] = "Metadata";
                this.details["Metadata"] = value;
            } else {
                this.details["Value"] = value;
            }
        } catch (e: any) {
            this.details["Parse Error"] = e.toString();
        }
    }

    get_type_name(): string {
        return TAG_TYPES[this.tag_type as keyof typeof TAG_TYPES] || `Unknown (${this.tag_type})`;
    }

    get_display_info(): { [key: string]: any; } {
        const info = {
            "Offset": `0x${this.offset.toString(16).toUpperCase().padStart(8, '0')}`,
            "Type": this.get_type_name(),
            "Size": this.data_size,
            "Timestamp": `${this.timestamp} ms`
        };
        if (Object.keys(this.analysis).length > 0) {
            (info as any)["Analysis"] = this.analysis;
        }
        (info as any)["Details"] = this.details;
        return info;
    }
}


export class FlvViewerProvider implements vscode.CustomReadonlyEditorProvider {
    public static readonly viewType = 'flvTagPreview.viewer';

    constructor(private readonly context: vscode.ExtensionContext) { }

    public async openCustomDocument(
        uri: vscode.Uri,
        _openContext: vscode.CustomDocumentOpenContext,
        _token: vscode.CancellationToken
    ): Promise<vscode.CustomDocument> {
        return { uri, dispose: () => { } };
    }

    public async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
        };

        try {
            const fileContent = await vscode.workspace.fs.readFile(document.uri);
            const { header, tags, metadata } = this._parseFlv(Buffer.from(fileContent));

            webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);

            webviewPanel.webview.postMessage({
                command: 'flvData',
                header,
                tags: tags.map(t => t.get_display_info()),
                metadata
            });

        } catch (e: any) {
            webviewPanel.webview.html = `<h1>Error parsing FLV file</h1><p>${e.message}</p>`;
        }
    }

    private _parseFlv(data: Buffer): { header: FlvHeader, tags: FlvTag[], metadata: any } {
        if (data.length < 9 || data.toString('utf8', 0, 3) !== 'FLV') {
            throw new Error("Invalid FLV file");
        }

        const header: FlvHeader = {
            Version: data[3],
            HasVideo: !!(data[4] & 1),
            HasAudio: !!(data[4] & 4),
            HeaderSize: data.readUInt32BE(5)
        };

        let offset = header.HeaderSize;
        // PreviousTagSize0 is always 0
        offset += 4;

        let metadata = {};
        const tags: FlvTag[] = [];

        // First pass to find metadata
        let tempOffset = offset;
        while (tempOffset < data.length - 11) {
            const tagHeaderData = data.slice(tempOffset, tempOffset + 11);
            const data_size = (tagHeaderData[1] << 16) | (tagHeaderData[2] << 8) | tagHeaderData[3];
            const tag_type = tagHeaderData[0];

            if (tag_type === 18) { // Script Data
                const tagData = data.slice(tempOffset, tempOffset + 11 + data_size);
                const tag = new FlvTagImpl(tempOffset, tagData, {});
                if (tag.details["Name"] === "onMetaData") {
                    metadata = tag.details["Metadata"];
                    break; // Found it
                }
            }
            tempOffset += 11 + data_size + 4;
        }


        while (offset < data.length - 11) {
            const data_size = (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
            const tagData = data.slice(offset, offset + 11 + data_size);
            tags.push(new FlvTagImpl(offset, tagData, metadata));
            offset += 11 + data_size + 4; // 11 for header, data_size, 4 for previous tag size
        }

        return { header, tags, metadata };
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>FLV Tag Preview</title>
                <style>
                    /* Add styles for foldable tree */
                    .tree-item {
                        margin-left: 20px;
                    }
                    .tree-item-header {
                        cursor: pointer;
                        user-select: none;
                    }
                    .tree-item-header::before {
                        content: "▶";
                        display: inline-block;
                        width: 15px;
                    }
                    .tree-item-header.expanded::before {
                        transform: rotate(90deg);
                    }
                    .tree-item-children {
                        display: none;
                    }
                    .tree-item-children.expanded {
                        display: block;
                    }
                </style>
            </head>
            <body>
                <h1>FLV Info</h1>
                <h2>Header</h2>
                <div id="header"></div>
                <h2>Metadata</h2>
                <div id="metadata"></div>
                <h2>Tags</h2>
                <div id="tags"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
