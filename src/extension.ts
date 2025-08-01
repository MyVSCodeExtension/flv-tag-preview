// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { FlvViewerProvider } from './FlvViewerProvider';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Congratulations, your extension "flv-tag-preview" is now active!');

	// Register our custom editor provider
	const provider = new FlvViewerProvider(context);
	context.subscriptions.push(
		vscode.window.registerCustomEditorProvider(FlvViewerProvider.viewType, provider, {
			supportsMultipleEditorsPerDocument: false,
			webviewOptions: {
				retainContextWhenHidden: true,
			}
		})
	);

	// Register a command to open the FLV viewer panel (optional, can be triggered by clicking the view)
	const openPreviewCommand = vscode.commands.registerCommand('flv-tag-preview.openPreview', (uri: vscode.Uri) => {
		FlvViewerProvider.openPreview(context, uri);
	});
	context.subscriptions.push(openPreviewCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}