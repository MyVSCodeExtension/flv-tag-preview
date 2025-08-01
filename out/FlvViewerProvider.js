"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlvViewerProvider = void 0;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class FlvViewerProvider {
    constructor(context) {
        this._context = context;
    }
    // Open a preview panel for a given URI
    static openPreview(context, uri) {
        // In a real implementation, you might want to manage multiple panels or find existing ones
        // For simplicity, we'll just log for now
        console.log(`Opening preview for ${uri.fsPath}`);
    }
    // Called when our custom editor is opened
    async resolveCustomEditor(document, webviewPanel, _token) {
        // Setup initial html for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        // Set the initial HTML content
        webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);
        const filePath = document.uri.fsPath;
        // Check if it's an FLV file
        if (!filePath.toLowerCase().endsWith('.flv')) {
            webviewPanel.webview.postMessage({ command: 'error', message: 'Selected file is not an FLV file.' });
            return;
        }
        try {
            // Parse the FLV file
            const { header, tags, metadata } = await this._parseFlvFile(filePath);
            // Send parsed data to the webview
            webviewPanel.webview.postMessage({
                command: 'update',
                header: header,
                metadata: metadata,
                tags: tags
            });
        }
        catch (error) {
            console.error('Error parsing FLV file:', error);
            webviewPanel.webview.postMessage({ command: 'error', message: `Error parsing FLV file: ${error.message}` });
        }
        // Handle messages from the webview
        webviewPanel.webview.onDidReceiveMessage(message => {
            switch (message.command) {
                case 'alert':
                    vscode.window.showErrorMessage(message.text);
                    return;
            }
        }, undefined, this._context.subscriptions);
    }
    // Create a CustomDocument for a given URI
    async openCustomDocument(uri, openContext, token) {
        return {
            uri,
            dispose: () => { }
        };
    }
    // Enhanced FLV parser
    async _parseFlvFile(filePath) {
        return new Promise((resolve, reject) => {
            fs.readFile(filePath, (err, data) => {
                if (err) {
                    reject(err);
                    return;
                }
                let offset = 0;
                const header = {
                    signature: '',
                    version: 0,
                    flags: { hasAudio: false, hasVideo: false },
                    dataOffset: 0
                };
                const tags = [];
                const metadata = {};
                try {
                    // Parse FLV Header (9 bytes)
                    if (data.length < 9) {
                        throw new Error('File too small to be a valid FLV file');
                    }
                    header.signature = data.toString('utf8', 0, 3);
                    if (header.signature !== 'FLV') {
                        throw new Error('Invalid FLV signature');
                    }
                    header.version = data.readUInt8(3);
                    const flags = data.readUInt8(4);
                    header.flags = {
                        hasAudio: (flags & 0x04) !== 0,
                        hasVideo: (flags & 0x01) !== 0
                    };
                    header.dataOffset = data.readUInt32BE(5);
                    offset = header.dataOffset;
                    // Skip previous tag size (4 bytes)
                    offset += 4;
                    // Parse FLV Tags
                    let tagIndex = 0;
                    while (offset < data.length - 15) { // Ensure there's enough data for a minimal tag header
                        const tagType = data.readUInt8(offset);
                        const dataSize = data.readUIntBE(offset + 1, 3);
                        const timestamp = data.readUIntBE(offset + 4, 3);
                        const timestampExtended = data.readUInt8(offset + 7);
                        const streamId = data.readUIntBE(offset + 8, 3);
                        const fullTimestamp = (timestampExtended << 24) | timestamp;
                        if (offset + 11 + dataSize > data.length) {
                            console.warn('Incomplete tag found at offset', offset);
                            break; // Stop parsing if tag exceeds file size
                        }
                        const tagBody = data.subarray(offset + 11, offset + 11 + dataSize);
                        let tag;
                        // Parse based on tag type
                        switch (tagType) {
                            case 8: // Audio
                                tag = this._parseAudioTag(tagBody, dataSize, fullTimestamp, streamId, tagIndex);
                                break;
                            case 9: // Video
                                tag = this._parseVideoTag(tagBody, dataSize, fullTimestamp, streamId, tagIndex);
                                break;
                            case 18: // Script
                                tag = this._parseScriptTag(tagBody, dataSize, fullTimestamp, streamId, tagIndex);
                                // Extract metadata from script tag
                                if (tag.type === 'script' && tag.details) {
                                    Object.assign(metadata, tag.details);
                                }
                                break;
                            default:
                                // Unknown tag type, create a generic one
                                tag = {
                                    type: 'script',
                                    dataSize: dataSize,
                                    timestamp: fullTimestamp,
                                    streamId: streamId,
                                    details: {
                                        error: `Unknown tag type: ${tagType}`,
                                        body: tagBody.toString('hex')
                                    }
                                };
                        }
                        tags.push(tag);
                        tagIndex++;
                        offset += 11 + dataSize + 4; // Tag header + body + previous tag size (4 bytes)
                    }
                    resolve({ header, tags, metadata });
                }
                catch (parseError) {
                    reject(parseError);
                }
            });
        });
    }
    // Parse Audio Tag
    _parseAudioTag(body, dataSize, timestamp, streamId, index) {
        const soundFormat = (body[0] & 0xF0) >> 4;
        const soundRate = (body[0] & 0x0C) >> 2;
        const soundSize = (body[0] & 0x02) >> 1;
        const soundType = body[0] & 0x01;
        const tag = {
            type: 'audio',
            dataSize: dataSize,
            timestamp: timestamp,
            streamId: streamId,
            soundFormat: soundFormat,
            soundRate: soundRate,
            soundSize: soundSize,
            soundType: soundType,
            details: {
                index: index,
                soundFormatStr: this._getSoundFormatStr(soundFormat),
                soundRateStr: this._getSoundRateStr(soundRate),
                soundSizeStr: soundSize === 0 ? '8-bit' : '16-bit',
                soundTypeStr: soundType === 0 ? 'Mono' : 'Stereo'
            }
        };
        // For AAC (format 10)
        if (soundFormat === 10 && body.length > 1) {
            tag.aacPacketType = body[1];
            tag.details.aacPacketTypeStr = tag.aacPacketType === 0 ? 'Sequence Header' : 'Raw';
            // Skip AAC sequence header for details
            if (tag.aacPacketType !== 0 && body.length > 2) {
                // Include raw AAC data (truncated)
                const aacData = body.subarray(2, Math.min(20, body.length));
                tag.details.rawAacData = aacData.toString('hex');
            }
        }
        else if (body.length > 1) {
            // Include raw audio data (truncated)
            const audioData = body.subarray(1, Math.min(20, body.length));
            tag.details.rawAudioData = audioData.toString('hex');
        }
        return tag;
    }
    // Parse Video Tag
    _parseVideoTag(body, dataSize, timestamp, streamId, index) {
        const frameType = (body[0] & 0xF0) >> 4;
        const codecId = body[0] & 0x0F;
        const tag = {
            type: 'video',
            dataSize: dataSize,
            timestamp: timestamp,
            streamId: streamId,
            frameType: frameType,
            codecId: codecId,
            details: {
                index: index,
                frameTypeStr: this._getFrameTypeStr(frameType),
                codecIdStr: this._getCodecIdStr(codecId)
            }
        };
        // For H.264 (codec 7)
        if (codecId === 7 && body.length > 4) {
            tag.avcPacketType = body[1];
            // Composition time is a signed 24-bit integer
            const compositionTimeBytes = body.subarray(2, 5);
            let compositionTime = compositionTimeBytes[0] << 16 | compositionTimeBytes[1] << 8 | compositionTimeBytes[2];
            // Convert to signed 24-bit integer
            if (compositionTime & 0x800000) {
                compositionTime = compositionTime - 0x1000000;
            }
            tag.compositionTime = compositionTime;
            tag.details.avcPacketTypeStr = this._getAvcPacketTypeStr(tag.avcPacketType);
            tag.details.compositionTime = compositionTime;
            // Skip AVC sequence header/configuration record for details
            if (tag.avcPacketType !== 0 && body.length > 5) {
                // Include raw H.264 NAL data (truncated)
                const nalData = body.subarray(5, Math.min(25, body.length));
                tag.details.rawNalData = nalData.toString('hex');
            }
        }
        else if (body.length > 1) {
            // Include raw video data (truncated)
            const videoData = body.subarray(1, Math.min(20, body.length));
            tag.details.rawVideoData = videoData.toString('hex');
        }
        return tag;
    }
    // Parse Script Tag (simplified)
    _parseScriptTag(body, dataSize, timestamp, streamId, index) {
        // This is a very simplified script tag parser.
        // A full implementation would need a proper AMF0/AMF3 parser.
        // Here we just look for some common keys.
        const tag = {
            type: 'script',
            dataSize: dataSize,
            timestamp: timestamp,
            streamId: streamId,
            details: {
                index: index
            }
        };
        // Look for "onMetaData" string which usually starts the metadata object
        const onMetaDataIndex = body.indexOf('onMetaData');
        if (onMetaDataIndex !== -1) {
            tag.name = 'onMetaData';
            tag.details.name = 'onMetaData';
            // This is a very basic heuristic and not a real parser
            // In a real-world scenario, you'd use an AMF parser library
            try {
                // Try to find simple key-value pairs after onMetaData
                // This is highly simplified and error-prone
                let pos = onMetaDataIndex + 'onMetaData'.length;
                // Skip some bytes that are part of AMF encoding structure
                // This is a guess and may not work for all files
                pos += 3;
                while (pos < body.length - 8) {
                    // Check for string type marker (0x02)
                    if (body.readUInt8(pos) === 0x02) {
                        const strLen = body.readUInt16BE(pos + 1);
                        if (pos + 3 + strLen <= body.length) {
                            const key = body.toString('utf8', pos + 3, pos + 3 + strLen);
                            pos += 3 + strLen;
                            // Check for number type marker (0x00)
                            if (body.readUInt8(pos) === 0x00 && pos + 9 <= body.length) {
                                // Read 64-bit big-endian float (double)
                                const value = body.readDoubleBE(pos + 1);
                                tag.details[key] = value;
                                pos += 9;
                            }
                            else if (body.readUInt8(pos) === 0x01 && pos + 2 <= body.length) {
                                // Boolean type (0x01)
                                const boolValue = body.readUInt8(pos + 1) !== 0;
                                tag.details[key] = boolValue;
                                pos += 2;
                            }
                            else {
                                // Skip unknown types or complex structures
                                pos++;
                            }
                        }
                        else {
                            break;
                        }
                    }
                    else {
                        pos++;
                    }
                }
            }
            catch (e) {
                console.warn('Error extracting metadata:', e);
                tag.details.parseError = `Error parsing script tag: ${e}`;
            }
        }
        else {
            tag.details.note = 'Script tag does not contain "onMetaData"';
            // Include raw data (truncated)
            const scriptData = body.subarray(0, Math.min(30, body.length));
            tag.details.rawScriptData = scriptData.toString('hex');
        }
        return tag;
    }
    // Helper functions for human-readable strings
    _getSoundFormatStr(format) {
        const formats = [
            'Linear PCM, platform endian',
            'ADPCM',
            'MP3',
            'Linear PCM, little endian',
            'Nellymoser 16-kHz mono',
            'Nellymoser 8-kHz mono',
            'Nellymoser',
            'G.711 A-law logarithmic PCM',
            'G.711 mu-law logarithmic PCM',
            'reserved',
            'AAC',
            'Speex',
            'reserved',
            'reserved',
            'MP3 8-Khz',
            'Device-specific sound'
        ];
        return formats[format] || `Unknown (${format})`;
    }
    _getSoundRateStr(rate) {
        const rates = ['5.5-kHz', '11-kHz', '22-kHz', '44-kHz'];
        return rates[rate] || `Unknown (${rate})`;
    }
    _getFrameTypeStr(frameType) {
        const types = ['reserved', 'Keyframe (for AVC, a seekable frame)', 'Inter frame (for AVC, a non-seekable frame)', 'Disposable inter frame (H.263 only)', 'Generated keyframe (reserved for server use only)', 'Video info/command frame'];
        return types[frameType] || `Unknown (${frameType})`;
    }
    _getCodecIdStr(codecId) {
        const codecs = ['Reserved', 'JPEG (currently unused)', 'Sorenson H.263', 'Screen video', 'On2 VP6', 'On2 VP6 with alpha channel', 'Screen video version 2', 'AVC'];
        return codecs[codecId] || `Unknown (${codecId})`;
    }
    _getAvcPacketTypeStr(packetType) {
        const types = ['AVC sequence header', 'AVC NALU', 'AVC end of sequence (lower level NALU sequence ender is not required or supported)'];
        return types[packetType] || `Unknown (${packetType})`;
    }
    // Helper to get tag type string (kept for backward compatibility)
    _getTagType(type) {
        switch (type) {
            case 8: return 'audio';
            case 9: return 'video';
            case 18: return 'script';
            default: return 'script'; // Default or unknown
        }
    }
    // Get the static html used for the webview
    _getHtmlForWebview(webview) {
        // Local path to script and css for the webview
        const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this._context.extensionPath, 'media', 'main.js')));
        // Use a nonce to whitelist which scripts can be run
        const nonce = this._getNonce();
        return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<title>FLV Tag Preview</title>
				<style>
					body {
						font-family: var(--vscode-font-family);
						font-size: var(--vscode-editor-font-size);
						color: var(--vscode-editor-foreground);
						background-color: var(--vscode-editor-background);
						margin: 0;
						padding: 10px;
					}
					h1, h2, h3 {
						color: var(--vscode-foreground);
					}
					.container {
						padding: 10px;
					}
					.info-section {
						margin-bottom: 20px;
					}
					.info-table {
						width: 100%;
						border-collapse: collapse;
						margin-top: 5px;
					}
					.info-table th, .info-table td {
						border: 1px solid var(--vscode-input-border);
						padding: 5px 10px;
						text-align: left;
					}
					.info-table th {
						background-color: var(--vscode-sideBarSectionHeader-background);
						font-weight: bold;
					}
					.tags-tree {
						border: 1px solid var(--vscode-input-border);
						border-radius: 3px;
						padding: 5px;
						max-height: 500px;
						overflow-y: auto;
					}
					.tree-item {
						margin-left: 20px;
						padding: 2px 0;
					}
					.tree-item-header {
						cursor: pointer;
						user-select: none;
						padding: 3px;
						border-radius: 3px;
					}
					.tree-item-header:hover {
						background-color: var(--vscode-list-hoverBackground);
					}
					.tree-item-header::before {
						content: "▶";
						display: inline-block;
						width: 15px;
						transition: transform 0.2s;
					}
					.tree-item-header.expanded::before {
						transform: rotate(90deg);
					}
					.tree-item-children {
						display: none;
						padding-left: 15px;
					}
					.tree-item-children.expanded {
						display: block;
					}
					.tag-details {
						font-family: monospace;
						white-space: pre-wrap;
						word-break: break-all;
						background-color: var(--vscode-textBlockQuote-background);
						padding: 5px;
						border-radius: 3px;
						margin-top: 5px;
					}
					.error {
						color: var(--vscode-errorForeground);
					}
				</style>
			</head>
			<body>
				<div class="container">
					<h1>FLV File Information</h1>
					
					<div class="info-section">
						<h2>Header</h2>
						<table class="info-table" id="header-table">
							<thead>
								<tr>
									<th>Property</th>
									<th>Value</th>
								</tr>
							</thead>
							<tbody id="header-content">
								<tr><td colspan="2">Loading...</td></tr>
							</tbody>
						</table>
					</div>
					
					<div class="info-section">
						<h2>Metadata</h2>
						<table class="info-table" id="metadata-table">
							<thead>
								<tr>
									<th>Property</th>
									<th>Value</th>
								</tr>
							</thead>
							<tbody id="metadata-content">
								<tr><td colspan="2">Loading...</td></tr>
							</tbody>
						</table>
					</div>
					
					<div class="info-section">
						<h2>Tags</h2>
						<div id="tags-content" class="tags-tree">Loading...</div>
					</div>
					
					<div id="error-message" class="error"></div>
				</div>
				
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
    }
    _getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
exports.FlvViewerProvider = FlvViewerProvider;
FlvViewerProvider.viewType = 'flvTagPreview.viewer';
//# sourceMappingURL=FlvViewerProvider.js.map