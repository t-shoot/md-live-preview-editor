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

/**
 * Some ways of opening a `.md` file (e.g. `vscode.window.showTextDocument`,
 * used by many extensions — including AI chat panels — to open a referenced
 * file) bypass `workbench.editorAssociations` entirely and always land in the
 * plain text editor. This watches every tab as it opens/changes and reopens
 * any such file in Live Preview when `mdLivePreview.defaultEditor` is set to
 * always use it, reusing the same tab/column so no split is created.
 */
async function maybeReopenAsLivePreview(tab: vscode.Tab): Promise<void> {
	const mode = vscode.workspace.getConfiguration('mdLivePreview').get<string>('defaultEditor', 'prompt');
	if (mode !== 'livePreview') return;

	const input = tab.input;
	if (!(input instanceof vscode.TabInputText)) return;
	if (!/\.md$/i.test(input.uri.path)) return;
	if (sourceOverrideUris.has(input.uri.toString())) return;

	await vscode.commands.executeCommand(
		'vscode.openWith',
		input.uri,
		MarkdownLivePreviewProvider.viewType,
		tab.group.viewColumn,
	);
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
