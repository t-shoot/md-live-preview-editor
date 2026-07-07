import * as vscode from 'vscode';
import type { HostToSidebarMessage, SidebarSettings, SidebarToHostMessage, ThemeKind } from '../shared/messages';
import { StyleStore } from './styleStore';
import { StylePreviewController } from './StylePreviewController';

const CONFIG_SECTION = 'mdLivePreview';

export class StyleManagerViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'mdLivePreview.styleManager';

	private view: vscode.WebviewView | undefined;
	private readonly preview: StylePreviewController;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly styleStore: StyleStore,
	) {
		this.preview = new StylePreviewController(context, styleStore);
		this.styleStore.onDidChange(() => void this.pushStyles());
		// Re-push when the surfaced settings change or the color theme flips, so the
		// settings controls and the preview thumbnails' light/dark rendering stay current.
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (
					e.affectsConfiguration(`${CONFIG_SECTION}.defaultEditor`) ||
					e.affectsConfiguration(`${CONFIG_SECTION}.codeTheme`)
				) {
					void this.pushStyles();
				}
			}),
			vscode.window.onDidChangeActiveColorTheme(() => void this.pushStyles()),
		);
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
				vscode.Uri.joinPath(this.context.extensionUri, 'media'),
			],
		};
		webviewView.webview.html = this.buildHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((message: SidebarToHostMessage) => void this.handleMessage(message));
		webviewView.onDidDispose(() => {
			if (this.view === webviewView) {
				this.view = undefined;
			}
		});
	}

	async createNewStyle(): Promise<void> {
		const uri = await this.styleStore.createNewStyle();
		// Open the new file with the live preview beside it, same as the edit action.
		const name = uri.path.split('/').pop() ?? '';
		await this.preview.open(name, name);
	}

	private async handleMessage(message: SidebarToHostMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				await this.pushStyles();
				break;
			case 'toggle':
				await this.styleStore.setEnabled(message.id, message.enabled);
				break;
			case 'newStyle':
				await this.createNewStyle();
				break;
			case 'openStyle':
				// Open the CSS on the left and a live preview beside it on the right.
				await this.preview.open(message.id, message.id);
				break;
			case 'duplicateStyle':
				await this.styleStore.duplicateStyle(message.id);
				break;
			case 'renameStyle':
				await this.renameStyle(message.id);
				break;
			case 'deleteStyle':
				await this.styleStore.deleteStyle(message.id);
				break;
			case 'setSetting':
				await vscode.workspace
					.getConfiguration(CONFIG_SECTION)
					.update(message.key, message.value, vscode.ConfigurationTarget.Global);
				break;
		}
	}

	private async renameStyle(id: string): Promise<void> {
		const current = id.replace(/\.css$/i, '');
		const input = await vscode.window.showInputBox({
			title: 'スタイルの名前を変更',
			value: current,
			prompt: '新しい名前（.css は自動で付きます）',
			validateInput: (v) => (v.trim().length === 0 ? '名前を入力してください' : undefined),
		});
		if (input === undefined) return; // cancelled
		try {
			await this.styleStore.renameStyle(id, input);
		} catch {
			await vscode.window.showErrorMessage(`「${input}」に名前を変更できませんでした（同名のスタイルが既に存在します）。`);
		}
	}

	private getSettings(): SidebarSettings {
		const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
		return {
			defaultEditor: config.get<string>('defaultEditor', 'prompt'),
			codeTheme: config.get<string>('codeTheme', 'auto'),
		};
	}

	private getThemeKind(): ThemeKind {
		switch (vscode.window.activeColorTheme.kind) {
			case vscode.ColorThemeKind.Light:
				return 'vscode-light';
			case vscode.ColorThemeKind.HighContrast:
			case vscode.ColorThemeKind.HighContrastLight:
				return 'vscode-high-contrast';
			default:
				return 'vscode-dark';
		}
	}

	private async pushStyles(): Promise<void> {
		if (!this.view) return;
		const styles = await this.styleStore.listEntries();
		const msg: HostToSidebarMessage = {
			type: 'init',
			styles,
			settings: this.getSettings(),
			themeKind: this.getThemeKind(),
		};
		void this.view.webview.postMessage(msg);
	}

	private buildHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-sidebar.js'),
		);
		const styleUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'media', 'webview-sidebar-style.css'),
		);
		const nonce = getNonce();

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
	<link rel="stylesheet" href="${styleUri}" />
	<title>CSS Themes</title>
</head>
<body>
	<div id="mlp-sidebar-root"></div>
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
