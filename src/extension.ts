import * as vscode from 'vscode';
import { MarkdownLivePreviewProvider } from './editor/MarkdownLivePreviewProvider';
import { StyleManagerViewProvider } from './sidebar/StyleManagerViewProvider';
import { StyleStore } from './sidebar/styleStore';

function getActiveMarkdownUri(): vscode.Uri | undefined {
	if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
		return vscode.window.activeTextEditor.document.uri;
	}
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof vscode.TabInputText) {
		return input.uri;
	}
	return undefined;
}

function getActiveCustomEditorUri(): vscode.Uri | undefined {
	const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
	if (input instanceof vscode.TabInputCustom) {
		return input.uri;
	}
	return undefined;
}

// Files the user explicitly asked to view as plain source (via "ソースを開く"),
// exempted from the auto-reopen-as-Live-Preview watcher below until closed or
// reopened in Live Preview again. Keyed by `Uri#toString()`.
const sourceOverrideUris = new Set<string>();

// URIs currently being converted to Live Preview by `maybeReopenAsLivePreview`.
// `onDidChangeTabs` can report the same tab open in both its `opened` and
// `changed` batches, which without this guard would race two overlapping
// `vscode.openWith` calls for the same file and could leave two tabs open.
const reopeningUris = new Set<string>();

/**
 * Whether VS Code considers this tab's document to be Markdown. Prefers the
 * document's actual language mode over the filename: a file recognized as
 * Markdown (via the user's own `files.associations`, for instance) is still
 * picked up even when its name doesn't literally end in ".md" — e.g. a
 * duplicate download renamed by some tool to "note.md(1)". Falls back to the
 * filename check only when no matching open document is found yet (the tab
 * may not have one tracked at the very first `opened` event).
 */
function isMarkdownTab(input: vscode.TabInputText): boolean {
	const uriKey = input.uri.toString();
	const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uriKey);
	if (openDoc) return openDoc.languageId === 'markdown';
	return /\.md$/i.test(input.uri.path);
}

// Short, bounded backoff for `maybeReopenAsLivePreview` retries below — covers
// two distinct failure modes seen from third-party callers (AI chat panels,
// other extensions' "open this file" links) that this extension can't inspect
// or fix directly: (1) the document's language mode hasn't been assigned yet
// at the moment its tab first appears, so `isMarkdownTab` misses a file that
// *is* genuinely Markdown; (2) `vscode.openWith` itself intermittently rejects
// right after such a caller's own open call, before VS Code has finished
// settling that tab. Both are transient by nature — a short retry recovers
// them without any visible flicker, where giving up immediately would leave
// the file stuck showing as plain/raw text with no further trigger to fix it.
const REOPEN_RETRY_DELAYS_MS = [150, 500, 1500];

/**
 * Some ways of opening a `.md` file (e.g. `vscode.window.showTextDocument`,
 * used by many extensions — including AI chat panels — to open a referenced
 * file) bypass `workbench.editorAssociations` entirely and always land in the
 * plain text editor. This watches every tab as it opens/changes and reopens
 * any such file in Live Preview when `mdLivePreview.defaultEditor` is set to
 * always use it, reusing the same tab/column so no split is created.
 */
async function maybeReopenAsLivePreview(tab: vscode.Tab, attempt = 0): Promise<void> {
	const mode = vscode.workspace.getConfiguration('mdLivePreview').get<string>('defaultEditor', 'prompt');
	if (mode !== 'livePreview') return;

	const input = tab.input;
	if (!(input instanceof vscode.TabInputText)) return;
	const uriKey = input.uri.toString();
	if (sourceOverrideUris.has(uriKey)) return;
	if (reopeningUris.has(uriKey)) return;

	const retry = () => {
		if (attempt >= REOPEN_RETRY_DELAYS_MS.length) return;
		setTimeout(() => void maybeReopenAsLivePreview(tab, attempt + 1), REOPEN_RETRY_DELAYS_MS[attempt]);
	};

	if (!isMarkdownTab(input)) {
		retry();
		return;
	}

	reopeningUris.add(uriKey);
	try {
		await vscode.commands.executeCommand(
			'vscode.openWith',
			input.uri,
			MarkdownLivePreviewProvider.viewType,
			tab.group.viewColumn,
		);
		// `vscode.openWith` is expected to replace the originating tab in place,
		// but some ways of opening the file (e.g. a URI handled by another
		// extension's own logic after calling `showTextDocument`) can leave that
		// original plain-text tab open alongside the new Live Preview one.
		// Close any such leftover so at most one tab remains for this file.
		for (const group of vscode.window.tabGroups.all) {
			for (const leftover of group.tabs) {
				if (leftover.input instanceof vscode.TabInputText && leftover.input.uri.toString() === uriKey) {
					await vscode.window.tabGroups.close(leftover);
				}
			}
		}
	} catch {
		// `openWith` rejected (e.g. the tab hadn't fully settled yet) — the file
		// is still sitting there as plain text with nothing else queued to
		// retrigger this watcher, so retry ourselves rather than leaving it stuck.
		reopeningUris.delete(uriKey);
		retry();
		return;
	}
	reopeningUris.delete(uriKey);
}

async function syncDefaultEditorAssociation(): Promise<void> {
	const mode = vscode.workspace.getConfiguration('mdLivePreview').get<string>('defaultEditor', 'prompt');
	const rootConfig = vscode.workspace.getConfiguration();
	const associations = {
		...(rootConfig.get<Record<string, string>>('workbench.editorAssociations') ?? {}),
	};

	if (mode === 'livePreview') {
		associations['*.md'] = MarkdownLivePreviewProvider.viewType;
	} else if (mode === 'default') {
		associations['*.md'] = 'default';
	} else {
		delete associations['*.md'];
	}

	await rootConfig.update('workbench.editorAssociations', associations, vscode.ConfigurationTarget.Global);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const styleStore = new StyleStore(context);
	await styleStore.initialize();

	const { disposable: providerDisposable, provider } = MarkdownLivePreviewProvider.register(context, () =>
		styleStore.getCombinedCssSync(),
	);
	context.subscriptions.push(providerDisposable);
	context.subscriptions.push(styleStore.onDidChange(() => provider.broadcastCssChanged()));

	const styleManagerProvider = new StyleManagerViewProvider(context, styleStore);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(StyleManagerViewProvider.viewType, styleManagerProvider),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('mdLivePreview.openWithLivePreview', async () => {
			const uri = getActiveMarkdownUri();
			if (!uri) return;
			sourceOverrideUris.delete(uri.toString());
			const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
			await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownLivePreviewProvider.viewType, viewColumn);
		}),
		vscode.commands.registerCommand('mdLivePreview.openWithSource', async () => {
			const uri = getActiveCustomEditorUri();
			if (!uri) return;
			sourceOverrideUris.add(uri.toString());
			const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
			await vscode.commands.executeCommand('vscode.openWith', uri, 'default', viewColumn);
		}),
		vscode.commands.registerCommand('mdLivePreview.newStyle', async () => {
			await styleManagerProvider.createNewStyle();
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidCloseTextDocument((doc) => {
			sourceOverrideUris.delete(doc.uri.toString());
		}),
		vscode.window.tabGroups.onDidChangeTabs((e) => {
			for (const tab of [...e.opened, ...e.changed]) {
				void maybeReopenAsLivePreview(tab);
			}
		}),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('mdLivePreview.defaultEditor')) {
				void syncDefaultEditorAssociation();
			}
		}),
	);
	await syncDefaultEditorAssociation();
}

export function deactivate(): void {
	// All resources are registered on context.subscriptions and disposed by VS Code automatically.
}
