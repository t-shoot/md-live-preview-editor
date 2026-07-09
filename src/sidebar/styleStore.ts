import * as vscode from 'vscode';
import type { StyleEntry } from '../shared/messages';

const CONFIG_SECTION = 'mdLivePreview';
const ENABLED_STYLES_KEY = 'enabledStyles';

// Bumped whenever the bundled sample set changes; drives a one-time (re)seed so
// existing installs pick up new templates without re-creating ones the user
// later deleted.
const SAMPLES_VERSION = 5;
const SAMPLES_VERSION_KEY = 'mdLivePreview.samplesVersion';
// Bundled samples that were shipped before but are no longer wanted, deleted
// during migration: the old `.mlp-*`-selector themes that stopped working, plus
// DADS-light (dropped by request), the old hand-written GitHub.css (superseded
// by the github-markdown-css-derived `github.css`, itself later renamed to
// `github-like.css` — see the rename migration below), and Zenn.css (dropped by
// request, replaced by the VS Code-standard `vscode.css` sample). If one of
// these was the active theme, the selection falls back to the default sample.
const REMOVED_SAMPLE_NAMES = ['GitHub-like.css', 'Obsidian-like.css', 'DADS-light.css', 'GitHub.css', 'Zenn.css'];
// The pre-rename bundled name for what is now `github-like.css` (DEFAULT_STYLE_NAME).
const LEGACY_GITHUB_NAME = 'github.css';
const DEFAULT_STYLE_NAME = 'github-like.css';
// Bundled sample themes, shipped as real .css files under media/sample-styles/
// (not embedded as TS strings) so they're easy to review/maintain and can be
// read directly with `vscode.workspace.fs`. Written into global storage once on
// first seed so the user can edit/rename/delete them like any other style file.
const SAMPLE_FILE_NAMES = ['github-like.css', 'vscode.css'];

interface StyleFile {
	id: string;
	uri: vscode.Uri;
	name: string;
}

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

		let existing = new Set((await this.listAllStyleFiles()).map((f) => f.name));

		// One-time rename migration: the old bundled `github.css` becomes
		// `github-like.css`, preserving the user's own edits to it (unlike the
		// delete-and-reseed samples below, which are fully discontinued).
		if (existing.has(LEGACY_GITHUB_NAME) && !existing.has(DEFAULT_STYLE_NAME)) {
			try {
				await vscode.workspace.fs.rename(
					vscode.Uri.joinPath(dir, LEGACY_GITHUB_NAME),
					vscode.Uri.joinPath(dir, DEFAULT_STYLE_NAME),
					{ overwrite: false },
				);
				if (this.getEnabledIds().includes(LEGACY_GITHUB_NAME)) {
					await this.setEnabledIds([DEFAULT_STYLE_NAME]);
				}
				existing = new Set((await this.listAllStyleFiles()).map((f) => f.name));
			} catch {
				// rename failed (e.g. target already exists) — leave the old file as-is
			}
		}

		// Add any bundled sample that isn't present yet, reading its content from
		// the real .css file shipped under media/sample-styles/.
		for (const name of SAMPLE_FILE_NAMES) {
			if (existing.has(name)) continue;
			const bundled = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sample-styles', name);
			const content = await vscode.workspace.fs.readFile(bundled);
			await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), content);
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
		// the default sample so the initial state always has a theme applied.
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
