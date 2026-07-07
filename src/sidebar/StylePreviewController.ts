import * as vscode from 'vscode';
import type { HostToPreviewMessage, PreviewToHostMessage, ThemeKind } from '../shared/messages';
import { StyleStore } from './styleStore';

const PUSH_DEBOUNCE_MS = 120;

function currentThemeKind(): ThemeKind {
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

/**
 * Opens a CSS theme file for editing with a live preview panel beside it: the CSS
 * on the left, a rendered Markdown sample styled by that CSS on the right, updated
 * on every keystroke. One shared panel is reused as the user edits different themes.
 */
export class StylePreviewController {
	private panel: vscode.WebviewPanel | undefined;
	private currentUri: vscode.Uri | undefined;
	private currentName = '';
	private pushTimer: ReturnType<typeof setTimeout> | undefined;
	private lastSelector: string | null = null;

	constructor(
		private readonly context: vscode.ExtensionContext,
		private readonly styleStore: StyleStore,
	) {
		this.context.subscriptions.push(
			vscode.workspace.onDidChangeTextDocument((e) => {
				if (this.currentUri && e.document.uri.toString() === this.currentUri.toString()) {
					this.schedulePush(e.document.getText());
				}
			}),
			// Move the preview's highlight to whatever rule the cursor is now in.
			vscode.window.onDidChangeTextEditorSelection((e) => {
				if (this.currentUri && e.textEditor.document.uri.toString() === this.currentUri.toString()) {
					this.updateHighlight(e.textEditor.document, e.selections[0].active);
				}
			}),
			// Re-render when the user flips light/dark so `body.vscode-*` gated rules match.
			vscode.window.onDidChangeActiveColorTheme(() => void this.push()),
		);
	}

	/** Open `id`'s CSS on the left and (re)reveal the live preview on the right. */
	async open(id: string, name: string): Promise<void> {
		const uri = await this.styleStore.resolveStyleUri(id);
		if (!uri) return;
		const doc = await vscode.workspace.openTextDocument(uri);
		const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });

		// Key off the opened document's *own* URI, not the one we constructed to
		// resolve it. VS Code may canonicalize the file URI (e.g. drive-letter case
		// on Windows), and onDidChangeTextDocument/onDidChangeTextEditorSelection
		// carry that canonical URI — comparing against the constructed one would
		// silently never match, so edits wouldn't reach the preview.
		this.currentUri = doc.uri;
		this.currentName = name;
		this.ensurePanel();
		await this.push(doc.getText());
		this.updateHighlight(editor.document, editor.selection.active);
	}

	private ensurePanel(): void {
		const title = `プレビュー: ${this.currentName}`;
		if (this.panel) {
			this.panel.title = title;
			this.panel.reveal(vscode.ViewColumn.Beside, true);
			return;
		}
		this.panel = vscode.window.createWebviewPanel(
			'mdLivePreview.stylePreview',
			title,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
			},
		);
		this.panel.webview.html = this.buildHtml(this.panel.webview);
		this.panel.webview.onDidReceiveMessage((message: PreviewToHostMessage) => {
			if (message.type === 'ready') {
				void this.push();
				this.postHighlight(this.lastSelector);
			}
		});
		this.panel.onDidDispose(() => {
			this.panel = undefined;
			this.currentUri = undefined;
		});
	}

	private schedulePush(css: string): void {
		if (this.pushTimer) clearTimeout(this.pushTimer);
		this.pushTimer = setTimeout(() => {
			this.pushTimer = undefined;
			void this.push(css);
		}, PUSH_DEBOUNCE_MS);
	}

	private updateHighlight(doc: vscode.TextDocument, position: vscode.Position): void {
		const selector = selectorAtOffset(doc.getText(), doc.offsetAt(position));
		this.lastSelector = selector;
		this.postHighlight(selector);
	}

	private postHighlight(selector: string | null): void {
		if (!this.panel) return;
		const message: HostToPreviewMessage = { type: 'highlight', selector };
		void this.panel.webview.postMessage(message);
	}

	private async push(css?: string): Promise<void> {
		if (!this.panel || !this.currentUri) return;
		let content = css;
		if (content === undefined) {
			try {
				content = (await vscode.workspace.openTextDocument(this.currentUri)).getText();
			} catch {
				return; // file vanished
			}
		}
		const message: HostToPreviewMessage = {
			type: 'update',
			css: content,
			themeKind: currentThemeKind(),
			name: this.currentName,
		};
		void this.panel.webview.postMessage(message);
	}

	private buildHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview-preview.js'),
		);
		const nonce = getNonce();
		return `<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} https: data:;" />
	<style>
		html, body { margin: 0; }
		/* No horizontal scrolling: if content could overflow sideways, blocks (and
		   thus their highlight ring) would extend past the panel's right edge and
		   get clipped — leaving only the left of the ring visible. */
		html, body { overflow-x: hidden; }
		/* Match the editor: its base font size is VS Code's editor font size
		   (authoritative there too), so headings/inline code — sized in em — scale
		   the same way and the preview reads at the same size as the live editor. */
		#mlp-preview-content { padding: 1.5rem 1.5rem 3rem; font-size: var(--vscode-editor-font-size, 14px); }
		/* Wrap long code lines (like the editor does) so a code block never pushes
		   wider than the panel and its highlight ring stays fully on-screen. The
		   high-specificity selector overrides a theme's own pre white-space rule. */
		#mlp-preview-content pre {
			white-space: pre-wrap !important;
			overflow-wrap: anywhere !important;
			word-break: break-word !important;
		}
		/* Give the code inside a pre a real block box. As inline content it spans
		   several line fragments, and the highlight ring (an absolutely-positioned
		   overlay) can't wrap a fragmented inline box — it collapses to a thin bar
		   on the left. A block box makes the "pre code" highlight a clean rectangle. */
		#mlp-preview-content pre code {
			display: block !important;
		}
	</style>
	<style id="mlp-theme-style"></style>
	<!-- Placed after the theme style, with !important, so the glow always wins.
	     A soft "AI" gradient outline: blue and purple are present *at the same
	     time* as an actual gradient ring (drawn on ::after via the mask border
	     trick), and the gradient flows around the edge by scrolling its position.
	     A pale blue+purple box-shadow adds a gentle halo. Colors are kept light. -->
	<style>
		.mlp-hl {
			position: relative !important;
			border-radius: 6px !important;
		}
		/* A single transparent box sitting 6px outside the element. Every layer is
		   an *outset* box-shadow, which is painted only outside this box — so the
		   interior is guaranteed clean (no inner reflection, whatever the theme).
		   The two zero-blur layers form a two-tone edge (blue inner, purple just
		   outside) so both colors show at once; the blurred layers are the halo
		   that radiates outward. A slow breathe keeps it alive without the colors
		   flipping. */
		.mlp-hl::after {
			content: "" !important;
			position: absolute !important;
			inset: -6px !important; /* gap so the ring doesn't crowd the text */
			border-radius: 10px !important;
			pointer-events: none !important;
			animation: mlp-hl-breathe 2.8s ease-in-out infinite !important;
		}
		@keyframes mlp-hl-breathe {
			0%, 100% {
				box-shadow:
					0 0 0 1.4px rgba(127, 179, 255, 0.95),
					0 0 0 2.8px rgba(183, 155, 245, 0.60),
					0 0 9px 1px rgba(127, 179, 255, 0.50),
					0 0 22px 6px rgba(183, 155, 245, 0.34),
					0 0 40px 14px rgba(127, 179, 255, 0.14);
			}
			50% {
				box-shadow:
					0 0 0 1.4px rgba(127, 179, 255, 0.95),
					0 0 0 2.8px rgba(183, 155, 245, 0.60),
					0 0 13px 2px rgba(127, 179, 255, 0.62),
					0 0 30px 9px rgba(183, 155, 245, 0.48),
					0 0 54px 18px rgba(127, 179, 255, 0.20);
			}
		}
	</style>
	<title>Style Preview</title>
</head>
<body>
	<div id="mlp-preview-content"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

/**
 * Given a CSS source and a cursor offset, return the selector of the rule the
 * cursor is in — the innermost `{…}` block whose braces surround the offset, or
 * the prelude currently being typed just before a `{`. Comments are stripped and
 * at-rule preludes (`@media …`) are returned verbatim (the preview ignores them).
 * Returns null when the cursor isn't inside any rule.
 */
export function selectorAtOffset(css: string, offset: number): string | null {
	interface Block {
		preludeStart: number;
		preludeEnd: number;
		contentStart: number;
		contentEnd: number;
	}
	const blocks: Block[] = [];
	const stack: Array<{ preludeStart: number; preludeEnd: number; contentStart: number }> = [];
	let segStart = 0;
	let i = 0;
	const n = css.length;
	while (i < n) {
		// Skip comments and strings so braces inside them don't confuse the scan.
		if (css[i] === '/' && css[i + 1] === '*') {
			const end = css.indexOf('*/', i + 2);
			i = end === -1 ? n : end + 2;
			continue;
		}
		const ch = css[i];
		if (ch === '"' || ch === "'") {
			i++;
			while (i < n && css[i] !== ch) {
				if (css[i] === '\\') i++;
				i++;
			}
			i++;
			continue;
		}
		if (ch === '{') {
			stack.push({ preludeStart: segStart, preludeEnd: i, contentStart: i + 1 });
			segStart = i + 1;
		} else if (ch === '}') {
			const b = stack.pop();
			if (b) blocks.push({ ...b, contentEnd: i });
			segStart = i + 1;
		} else if (ch === ';' && stack.length === 0) {
			segStart = i + 1; // top-level statement (e.g. @import …;)
		}
		i++;
	}
	// Any still-open blocks (cursor typing inside an unclosed rule) count too.
	for (const b of stack) {
		blocks.push({ ...b, contentEnd: n });
	}

	const clean = (raw: string): string | null => {
		const s = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').trim();
		return s.length > 0 ? s : null;
	};

	// Innermost block whose *content* contains the offset (deepest = latest opened).
	let bestContent: Block | null = null;
	for (const b of blocks) {
		if (offset > b.contentStart - 1 && offset <= b.contentEnd) {
			if (!bestContent || b.contentStart > bestContent.contentStart) bestContent = b;
		}
	}
	if (bestContent) return clean(css.slice(bestContent.preludeStart, bestContent.preludeEnd));

	// Otherwise the cursor may sit in a prelude being typed (before its `{`).
	let bestPrelude: Block | null = null;
	for (const b of blocks) {
		if (offset >= b.preludeStart && offset <= b.preludeEnd) {
			if (!bestPrelude || b.preludeStart > bestPrelude.preludeStart) bestPrelude = b;
		}
	}
	if (bestPrelude) return clean(css.slice(bestPrelude.preludeStart, bestPrelude.preludeEnd));

	return null;
}

function getNonce(): string {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
