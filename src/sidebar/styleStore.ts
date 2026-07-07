import * as vscode from 'vscode';
import type { StyleEntry } from '../shared/messages';

const CONFIG_SECTION = 'mdLivePreview';
const ENABLED_STYLES_KEY = 'enabledStyles';

// Bumped whenever the bundled sample set changes; drives a one-time (re)seed so
// existing installs pick up new templates without re-creating ones the user
// later deleted.
const SAMPLES_VERSION = 4;
const SAMPLES_VERSION_KEY = 'mdLivePreview.samplesVersion';
// Bundled samples that were shipped before but are no longer wanted, deleted
// during migration: the old `.mlp-*`-selector themes that stopped working, plus
// DADS-light (dropped by request), plus the old hand-written GitHub.css
// (superseded by the github-markdown-css-derived `github.css`). If one of these
// was the active theme, the selection falls back to GitHub.
const REMOVED_SAMPLE_NAMES = ['GitHub-like.css', 'Obsidian-like.css', 'DADS-light.css', 'GitHub.css'];
const DEFAULT_STYLE_NAME = 'github.css';

interface StyleFile {
	id: string;
	uri: vscode.Uri;
	name: string;
}

// 日本語を含む本文で綺麗に表示されるフォントスタック。
const JP_FONT =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif';

// サンプルテーマは VS Code の Markdown プレビュー形式（`markdown.styles` に指定する
// のと同じ、素の HTML 要素セレクタ）で書く。webview 側でこの形式を CodeMirror の
// DOM 構造へ変換するので、VS Code 用の Markdown CSS をほぼそのまま利用できる。
//
// テーマは「ライトを既定にし、`body.vscode-dark …` でダーク配色に上書きする」形に
// している。コードブロックの背景色もこれで明暗が切り替わるため、シンタックス
// ハイライト（設定 `mdLivePreview.codeTheme` が既定の "auto" で VS Code のテーマに
// 追従）と常に読みやすい組み合わせになる。
const SAMPLE_STYLES: Record<string, string> = {
	'github.css': `/*
 * GitHub Dark (Colorblind) テーマ
 * github-markdown-css の dark_colorblind 配色を、VS Code の Markdown プレビュー形式
 * （HTML 要素セレクタ）に変換したもの。GitHub 固有のクラス（.octicon, .pl-*, g-emoji,
 * .alert, footnote 関連など）はこのアプリで生成されないため除外している。
 */
body {
	color-scheme: dark;
	margin: 0;
	font-weight: 400;
	color: #f0f6fc;
	background-color: #0d1117;
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
	font-size: 16px;
	line-height: 1.5;
	word-wrap: break-word;
}

body > *:first-child {
	margin-top: 0 !important;
}

body > *:last-child {
	margin-bottom: 0 !important;
}

a {
	text-decoration: underline;
	text-underline-offset: .2rem;
}

details, figcaption, figure {
	display: block;
}

summary {
	display: list-item;
}

[hidden] {
	display: none !important;
}

a {
	background-color: transparent;
	color: #4493f8;
	text-decoration: none;
}

a:hover {
	text-decoration: underline;
}

abbr[title] {
	border-bottom: none;
	-webkit-text-decoration: underline dotted;
	text-decoration: underline dotted;
}

b, strong {
	font-weight: 600;
}

dfn {
	font-style: italic;
}

h1 {
	margin: .67em 0;
	font-weight: 600;
	padding-bottom: .3em;
	font-size: 2em;
	border-bottom: 1px solid #3d444db3;
}

mark {
	background-color: #bb800926;
	color: #f0f6fc;
}

small {
	font-size: 90%;
}

sub, sup {
	font-size: 75%;
	line-height: 0;
	position: relative;
	vertical-align: baseline;
}

sub {
	bottom: -0.25em;
}

sup {
	top: -0.5em;
}

img {
	border-style: none;
	max-width: 100%;
	box-sizing: content-box;
}

code, kbd, pre, samp {
	font-family: monospace;
	font-size: 1em;
}

figure {
	margin: 1em 2.5rem;
}

hr {
	box-sizing: content-box;
	overflow: hidden;
	background: transparent;
	border-bottom: 1px solid #3d444db3;
	height: .25em;
	padding: 0;
	margin: 1.5rem 0;
	background-color: #3d444d;
	border: 0;
}

table {
	border-spacing: 0;
	border-collapse: collapse;
	display: block;
	width: max-content;
	max-width: 100%;
	overflow: auto;
	font-variant: tabular-nums;
}

td, th {
	padding: 0;
}

details summary {
	cursor: pointer;
}

kbd {
	display: inline-block;
	padding: 0.25rem;
	font: 11px ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
	line-height: 10px;
	color: #f0f6fc;
	vertical-align: middle;
	background-color: #151b23;
	border: solid 1px #3d444d;
	border-bottom-color: #3d444d;
	border-radius: 6px;
	box-shadow: inset 0 -1px 0 #3d444d;
}

h1, h2, h3, h4, h5, h6 {
	margin-top: 1.5rem;
	margin-bottom: 1rem;
	font-weight: 600;
	line-height: 1.25;
}

h2 {
	font-weight: 600;
	padding-bottom: .3em;
	font-size: 1.5em;
	border-bottom: 1px solid #3d444db3;
}

h3 {
	font-weight: 600;
	font-size: 1.25em;
}

h4 {
	font-weight: 600;
	font-size: 1em;
}

h5 {
	font-weight: 600;
	font-size: .875em;
}

h6 {
	font-weight: 600;
	font-size: .85em;
	color: #9198a1;
}

p {
	margin-top: 0;
	margin-bottom: 10px;
}

blockquote {
	margin: 0;
	padding: 0 1em;
	color: #9198a1;
	border-left: .25em solid #3d444d;
}

ul, ol {
	margin-top: 0;
	margin-bottom: 0;
	padding-left: 2em;
}

ol ol, ul ol {
	list-style-type: lower-roman;
}

ul ul ol, ul ol ol, ol ul ol, ol ol ol {
	list-style-type: lower-alpha;
}

dd {
	margin-left: 0;
}

tt, code, samp {
	font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
	font-size: 12px;
}

pre {
	margin-top: 0;
	margin-bottom: 0;
	font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
	font-size: 12px;
	word-wrap: normal;
}

p, blockquote, ul, ol, pre {
	margin-top: 0;
	margin-bottom: 1rem;
}

dl, table, details {
	margin-top: 0;
	margin-bottom: 1rem;
}

blockquote > :first-child {
	margin-top: 0;
}

blockquote > :last-child {
	margin-bottom: 0;
}

li > p {
	margin-top: 1rem;
}

li + li {
	margin-top: .25em;
}

dl {
	padding: 0;
}

dl dt {
	padding: 0;
	margin-top: 1rem;
	font-size: 1em;
	font-style: italic;
	font-weight: 600;
}

dl dd {
	padding: 0 1rem;
	margin-bottom: 1rem;
}

table th {
	font-weight: 600;
}

table th, table td {
	padding: 6px 13px;
	border: 1px solid #3d444d;
}

table td > :last-child {
	margin-bottom: 0;
}

table tr {
	background-color: #0d1117;
	border-top: 1px solid #3d444db3;
}

table tr:nth-child(2n) {
	background-color: #151b23;
}

table img {
	background-color: transparent;
}

img[align=right] {
	padding-left: 20px;
}

img[align=left] {
	padding-right: 20px;
}

code, tt {
	padding: .2em .4em;
	margin: 0;
	font-size: 85%;
	white-space: break-spaces;
	background-color: #656c7633;
	border-radius: 6px;
}

code br, tt br {
	display: none;
}

del code {
	text-decoration: inherit;
}

samp {
	font-size: 85%;
}

pre code {
	font-size: 100%;
}

pre > code {
	padding: 0;
	margin: 0;
	word-break: normal;
	white-space: pre;
	background: transparent;
	border: 0;
}

pre {
	padding: 1rem;
	overflow: auto;
	font-size: 85%;
	line-height: 1.45;
	color: #f0f6fc;
	background-color: #151b23;
	border-radius: 6px;
}

pre code, pre tt {
	display: inline;
	padding: 0;
	margin: 0;
	overflow: visible;
	line-height: inherit;
	word-wrap: normal;
	background-color: transparent;
	border: 0;
}
`,
	'Zenn.css': `/*
 * Zenn 風テーマ（zenn-content-css 由来の配色・行間）
 * ゆったりした行間（1.9）と Zenn ブルーのリンクが特徴。
 */
body {
	font-family: ${JP_FONT};
	font-size: 16px;
	line-height: 1.9;
	color: #1a1a1a;
	background-color: #ffffff;
}
h1, h2, h3, h4, h5, h6 { font-weight: 700; color: #1a1a1a; margin-top: 2em; margin-bottom: 0.8em; }
h1 { font-size: 1.7em; padding-bottom: 0.3em; border-bottom: 1px solid #d6e3ed; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #d6e3ed; }
h3 { font-size: 1.3em; }
h4 { font-size: 1.15em; }
strong { font-weight: 700; }
a { color: #0f83fd; text-decoration: none; }
a:hover { text-decoration: underline; }
blockquote { color: #65717b; border-left: 3px solid #8f9faa; padding: 2px 0 2px 0.7em; }
code { background: #edf2f7; border-radius: 4px; padding: 0.2em 0.4em; font-size: 0.85em; }
pre { background: #f4f6f8; padding: 1.1rem; border-radius: 8px; }
pre code { background: transparent; padding: 0; font-size: 1em; }
th, td { border: 1px solid #d6e3ed; padding: 0.4em 0.7em; }
th { background: #edf2f7; font-weight: 700; }
hr { border: none; border-top: 1px solid #d6e3ed; margin: 2em 0; }

/* VS Code がダークテーマのときはダーク配色にする */
body.vscode-dark { color: #d6e3ed; background-color: #16232e; }
body.vscode-dark h1, body.vscode-dark h2, body.vscode-dark h3, body.vscode-dark h4 { color: #d6e3ed; }
body.vscode-dark h1, body.vscode-dark h2 { border-bottom-color: #2e445c; }
body.vscode-dark a { color: #3ea8ff; }
body.vscode-dark blockquote { color: #8f9faa; border-left-color: #556676; }
body.vscode-dark code { background: #2e445c; }
body.vscode-dark pre { background: #1a2638; }
body.vscode-dark th, body.vscode-dark td { border-color: #2e445c; }
body.vscode-dark th { background: #22384c; }
body.vscode-dark hr { border-top-color: #2e445c; }
`,
};

const NEW_STYLE_TEMPLATE = `/*
 * 新しい Markdown Live Preview スタイル。
 * VS Code の Markdown プレビューと同じ CSS 形式（HTML 要素セレクタ）で書けます。
 * 例: body, h1〜h6, p, strong, em, a, ul, ol, li, code, pre, blockquote,
 *     table, th, td, hr, img, input[type=checkbox]
 * ダークテーマ用に上書きしたいときは body.vscode-dark を接頭辞に付けます。
 */
h1 {
	color: #4493f8;
}
`;

/**
 * Manages the user's CSS theme files. Styles are stored only in the extension's
 * global storage (per-workspace styles were intentionally dropped), and at most
 * one style is active at a time (the sidebar checkboxes behave exclusively).
 */
export class StyleStore {
	private cachedCss = '';
	private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.onDidChangeEmitter.event;

	constructor(private readonly context: vscode.ExtensionContext) {}

	private get stylesUri(): vscode.Uri {
		return vscode.Uri.joinPath(this.context.globalStorageUri, 'styles');
	}

	async initialize(): Promise<void> {
		await this.ensureSampleStyles();
		this.setupWatchers();
		await this.refresh();
	}

	private async ensureSampleStyles(): Promise<void> {
		// Run the seed/migration once per samples version so we don't fight a user
		// who deleted a sample, while still delivering new templates on upgrade.
		if (this.context.globalState.get<number>(SAMPLES_VERSION_KEY, 0) >= SAMPLES_VERSION) {
			return;
		}

		const dir = this.stylesUri;
		try {
			await vscode.workspace.fs.createDirectory(dir);
		} catch {
			// already exists (or unwritable) — proceed; writes below will surface real errors
		}

		const existing = new Set((await this.listAllStyleFiles()).map((f) => f.name));

		// Add any bundled sample that isn't present yet.
		for (const [name, content] of Object.entries(SAMPLE_STYLES)) {
			if (!existing.has(name)) {
				await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), Buffer.from(content, 'utf8'));
			}
		}

		// Delete samples we no longer ship.
		for (const removed of REMOVED_SAMPLE_NAMES) {
			if (existing.has(removed)) {
				try {
					await vscode.workspace.fs.delete(vscode.Uri.joinPath(dir, removed));
				} catch {
					// ignore — file may have vanished already
				}
			}
		}
		// If a removed theme was the active one — or nothing is active — fall back to
		// GitHub so the initial state always has a theme applied.
		const enabled = this.getEnabledIds();
		if (enabled.length === 0 || enabled.some((id) => REMOVED_SAMPLE_NAMES.includes(id))) {
			await this.setEnabledIds([DEFAULT_STYLE_NAME]);
		}

		await this.context.globalState.update(SAMPLES_VERSION_KEY, SAMPLES_VERSION);
	}

	private setupWatchers(): void {
		const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.stylesUri, '*.css'));
		const onAny = () => void this.refresh();
		watcher.onDidChange(onAny);
		watcher.onDidCreate(onAny);
		watcher.onDidDelete(onAny);
		this.context.subscriptions.push(watcher);
	}

	private async listAllStyleFiles(): Promise<StyleFile[]> {
		try {
			const entries = await vscode.workspace.fs.readDirectory(this.stylesUri);
			return entries
				.filter(([name, type]) => type === vscode.FileType.File && name.toLowerCase().endsWith('.css'))
				.map(([name]) => ({ id: name, uri: vscode.Uri.joinPath(this.stylesUri, name), name }))
				.sort((a, b) => a.name.localeCompare(b.name));
		} catch {
			return [];
		}
	}

	private getEnabledIds(): string[] {
		return vscode.workspace.getConfiguration(CONFIG_SECTION).get<string[]>(ENABLED_STYLES_KEY, []);
	}

	private async setEnabledIds(ids: string[]): Promise<void> {
		await vscode.workspace
			.getConfiguration(CONFIG_SECTION)
			.update(ENABLED_STYLES_KEY, ids, vscode.ConfigurationTarget.Global);
	}

	async listEntries(): Promise<StyleEntry[]> {
		const files = await this.listAllStyleFiles();
		const enabled = new Set(this.getEnabledIds());
		const entries: StyleEntry[] = [];
		for (const f of files) {
			let css = '';
			try {
				css = Buffer.from(await vscode.workspace.fs.readFile(f.uri)).toString('utf8');
			} catch {
				// unreadable between listing and reading — show it without a preview
			}
			entries.push({ id: f.id, name: f.name, enabled: enabled.has(f.id), css });
		}
		return entries;
	}

	/** Selection is exclusive: enabling a style disables every other one. */
	async setEnabled(id: string, enabled: boolean): Promise<void> {
		await this.setEnabledIds(enabled ? [id] : []);
		await this.refresh();
	}

	async createNewStyle(): Promise<vscode.Uri> {
		const dir = this.stylesUri;
		try {
			await vscode.workspace.fs.stat(dir);
		} catch {
			await vscode.workspace.fs.createDirectory(dir);
		}
		const existingNames = new Set((await this.listAllStyleFiles()).map((f) => f.name));
		let name = '新しいスタイル.css';
		let i = 1;
		while (existingNames.has(name)) {
			name = `新しいスタイル ${++i}.css`;
		}
		const uri = vscode.Uri.joinPath(dir, name);
		await vscode.workspace.fs.writeFile(uri, Buffer.from(NEW_STYLE_TEMPLATE, 'utf8'));
		return uri;
	}

	/** Copy a style to "<name> のコピー.css" (uniquified). The copy is not auto-enabled. */
	async duplicateStyle(id: string): Promise<vscode.Uri | undefined> {
		const files = await this.listAllStyleFiles();
		const file = files.find((f) => f.id === id);
		if (!file) return undefined;
		const base = file.name.replace(/\.css$/i, '');
		const existing = new Set(files.map((f) => f.name));
		let name = `${base} のコピー.css`;
		let i = 1;
		while (existing.has(name)) {
			name = `${base} のコピー ${++i}.css`;
		}
		const target = vscode.Uri.joinPath(this.stylesUri, name);
		const bytes = await vscode.workspace.fs.readFile(file.uri);
		await vscode.workspace.fs.writeFile(target, bytes);
		await this.refresh();
		return target;
	}

	/**
	 * Rename a style file. `rawName` is sanitized (path separators stripped, `.css`
	 * ensured). Throws if the target already exists. If the renamed style was the
	 * enabled one, the selection is carried over to the new name.
	 */
	async renameStyle(id: string, rawName: string): Promise<void> {
		const files = await this.listAllStyleFiles();
		const file = files.find((f) => f.id === id);
		if (!file) return;
		let name = rawName.trim().replace(/[\\/:*?"<>|]/g, '').trim();
		if (!name) return;
		if (!/\.css$/i.test(name)) name += '.css';
		if (name === file.name) return;
		const target = vscode.Uri.joinPath(this.stylesUri, name);
		// overwrite:false makes fs.rename throw if the target exists, surfacing a
		// clear error to the caller rather than silently clobbering another style.
		await vscode.workspace.fs.rename(file.uri, target, { overwrite: false });
		if (this.getEnabledIds().includes(id)) {
			await this.setEnabledIds([name]);
		}
		await this.refresh();
	}

	async deleteStyle(id: string): Promise<void> {
		const files = await this.listAllStyleFiles();
		const file = files.find((f) => f.id === id);
		if (!file) return;
		await vscode.workspace.fs.delete(file.uri);
		if (this.getEnabledIds().includes(id)) {
			await this.setEnabled(id, false);
		}
	}

	async openStyleForEditing(id: string): Promise<void> {
		const uri = await this.resolveStyleUri(id);
		if (!uri) return;
		const doc = await vscode.workspace.openTextDocument(uri);
		await vscode.window.showTextDocument(doc, { preview: false });
	}

	/** Resolve a style id to its file URI, or undefined if it no longer exists. */
	async resolveStyleUri(id: string): Promise<vscode.Uri | undefined> {
		const files = await this.listAllStyleFiles();
		return files.find((f) => f.id === id)?.uri;
	}

	private async computeCombinedCss(): Promise<string> {
		const files = await this.listAllStyleFiles();
		const enabled = new Set(this.getEnabledIds());
		const parts: string[] = [];
		for (const file of files) {
			if (!enabled.has(file.id)) continue;
			try {
				const bytes = await vscode.workspace.fs.readFile(file.uri);
				parts.push(`/* ${file.name} */\n${Buffer.from(bytes).toString('utf8')}`);
			} catch {
				// file became unreadable between listing and reading; skip it
			}
		}
		return parts.join('\n\n');
	}

	private async refresh(): Promise<void> {
		this.cachedCss = await this.computeCombinedCss();
		this.onDidChangeEmitter.fire();
	}

	getCombinedCssSync(): string {
		return this.cachedCss;
	}
}
