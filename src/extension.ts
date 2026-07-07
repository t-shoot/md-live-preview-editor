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
			await vscode.commands.executeCommand('vscode.openWith', uri, MarkdownLivePreviewProvider.viewType);
		}),
		vscode.commands.registerCommand('mdLivePreview.openWithSource', async () => {
			const uri = getActiveCustomEditorUri();
			if (!uri) return;
			await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
		}),
		vscode.commands.registerCommand('mdLivePreview.newStyle', async () => {
			await styleManagerProvider.createNewStyle();
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
