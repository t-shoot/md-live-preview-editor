import * as vscode from 'vscode';
import { DocumentSyncSession } from './documentSync';

export class MarkdownLivePreviewProvider implements vscode.CustomTextEditorProvider {
	static readonly viewType = 'mdLivePreview.editor';

	private readonly sessions = new Set<DocumentSyncSession>();

	private constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly getCss: () => string,
	) {}

	static register(
		context: vscode.ExtensionContext,
		getCss: () => string,
	): { disposable: vscode.Disposable; provider: MarkdownLivePreviewProvider } {
		const provider = new MarkdownLivePreviewProvider(context, getCss);
		const disposable = vscode.window.registerCustomEditorProvider(MarkdownLivePreviewProvider.viewType, provider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: true,
		});
		return { disposable, provider };
	}

	resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			],
		};
		webviewPanel.webview.html = this.buildHtml(webviewPanel.webview);

		const session = new DocumentSyncSession(document, webviewPanel, this.getCss);
		this.sessions.add(session);

		webviewPanel.onDidDispose(() => {
			session.dispose();
			this.sessions.delete(session);
		});
	}

	/** Called when the enabled CSS snippet set changes, to hot-reload every open panel. */
	broadcastCssChanged(): void {
		for (const session of this.sessions) {
			session.notifyCssChanged();
		}
	}

	private buildHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-editor.js'),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-editor-theme.css'),
		);
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>Markdown Live Preview</title>
</head>
<body>
	<div id="mlp-root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
