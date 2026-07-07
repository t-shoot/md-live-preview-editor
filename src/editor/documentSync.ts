import * as vscode from 'vscode';
import type { EditorToHostMessage, HostToEditorMessage, TextChange } from '../shared/messages';
import { pickCodeTheme, tokenizeDocument } from './shikiHost';

const REHIGHLIGHT_DEBOUNCE_MS = 150;

/**
 * Owns the sync relationship between one vscode.TextDocument and one webview panel
 * showing it. All edits from the webview are applied via WorkspaceEdit so that
 * VS Code's native undo/redo stack stays the single source of truth (CM6's own
 * history extension is intentionally not used in the webview).
 */
export class DocumentSyncSession {
	private disposables: vscode.Disposable[] = [];
	private lastAppliedVersion: number;
	// True for the entire span of an applyEdit() call, including the synchronous
	// onDidChangeTextDocument dispatch that happens *inside* workspace.applyEdit()
	// before its promise resolves. Without this, handleDocumentChanged sees that
	// echo before lastAppliedVersion has been bumped and mistakes our own edit for
	// an external one, re-sending it to the webview on top of text that already
	// has it — corrupting later offset math and losing/duplicating characters.
	private applyingLocalEdit = false;
	private rehighlightTimer: ReturnType<typeof setTimeout> | undefined;
	// Serializes 'edit' messages so a fast second edit can't race the first one's
	// applyEdit(): without this, its baseVersion check could run before the prior
	// edit has actually bumped document.version, defeating the staleness guard.
	private editQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly document: vscode.TextDocument,
		private readonly webviewPanel: vscode.WebviewPanel,
		private readonly getCss: () => string,
	) {
		this.lastAppliedVersion = document.version;

		this.disposables.push(
			webviewPanel.webview.onDidReceiveMessage((message: EditorToHostMessage) => this.handleMessage(message)),
		);

		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === document.uri.toString()) {
					this.handleDocumentChanged(event);
				}
			}),
		);

		this.disposables.push(
			vscode.window.onDidChangeActiveColorTheme(() => this.scheduleRehighlight(true)),
		);
	}

	private post(message: HostToEditorMessage) {
		this.webviewPanel.webview.postMessage(message);
	}

	private handleMessage(message: EditorToHostMessage) {
		switch (message.type) {
			case 'ready':
				this.sendInit();
				this.scheduleRehighlight(true);
				break;
			case 'edit':
				this.editQueue = this.editQueue.catch(() => undefined).then(() => this.applyEdit(message.changes, message.baseVersion));
				break;
			case 'undo':
				// Chained onto editQueue (not fired immediately) so it can't run ahead
				// of an 'edit' message still being applied — otherwise it would undo
				// the wrong (older) change and desync from the webview's local state.
				this.editQueue = this.editQueue.catch(() => undefined).then(() => vscode.commands.executeCommand('undo'));
				break;
			case 'redo':
				this.editQueue = this.editQueue.catch(() => undefined).then(() => vscode.commands.executeCommand('redo'));
				break;
			case 'openLink':
				void vscode.env.openExternal(vscode.Uri.parse(message.href));
				break;
		}
	}

	private sendInit() {
		this.post({
			type: 'init',
			text: this.document.getText(),
			version: this.document.version,
			css: this.getCss(),
			codeTheme: pickCodeTheme(),
		});
		this.lastAppliedVersion = this.document.version;
	}

	private async applyEdit(changes: TextChange[], baseVersion: number) {
		if (baseVersion !== this.document.version) {
			// Webview's batch was computed against a document snapshot that has since
			// moved on (e.g. an external edit landed concurrently). Rather than risk
			// corrupting the file with stale offsets, discard the batch and force a
			// full resync; the user may lose only the last, still-unacknowledged burst
			// of local keystrokes in this rare race.
			this.sendInit();
			return;
		}
		if (changes.length === 0) {
			return;
		}

		const edit = new vscode.WorkspaceEdit();
		for (const change of changes) {
			edit.replace(
				this.document.uri,
				new vscode.Range(this.document.positionAt(change.from), this.document.positionAt(change.to)),
				change.insert,
			);
		}

		this.applyingLocalEdit = true;
		try {
			await vscode.workspace.applyEdit(edit);
		} finally {
			this.applyingLocalEdit = false;
		}
		this.lastAppliedVersion = this.document.version;
		this.post({ type: 'ackEdit', version: this.document.version });
		this.scheduleRehighlight();
	}

	private handleDocumentChanged(event: vscode.TextDocumentChangeEvent) {
		if (this.applyingLocalEdit) {
			// Echo of the edit applyEdit() is in the middle of making; the webview
			// already reflects it locally, so there is nothing to forward. Still
			// track the version so a later genuine external edit compares correctly.
			this.lastAppliedVersion = event.document.version;
			return;
		}
		if (event.document.version <= this.lastAppliedVersion) {
			// This change is the echo of an edit we just applied ourselves; the
			// webview already reflects it locally, so there is nothing to forward.
			return;
		}
		this.lastAppliedVersion = event.document.version;
		if (event.contentChanges.length === 0) {
			return;
		}

		const changes: TextChange[] = event.contentChanges.map((c) => ({
			from: c.rangeOffset,
			to: c.rangeOffset + c.rangeLength,
			insert: c.text,
		}));
		this.post({ type: 'externalUpdate', changes, version: event.document.version });
		this.scheduleRehighlight();
	}

	private scheduleRehighlight(immediate = false) {
		if (this.rehighlightTimer) {
			clearTimeout(this.rehighlightTimer);
			this.rehighlightTimer = undefined;
		}
		const run = () => {
			this.rehighlightTimer = undefined;
			void tokenizeDocument(this.document).then((blocks) => {
				this.post({ type: 'codeTokens', blocks });
			});
		};
		if (immediate) {
			run();
		} else {
			this.rehighlightTimer = setTimeout(run, REHIGHLIGHT_DEBOUNCE_MS);
		}
	}

	notifyCssChanged() {
		this.post({ type: 'applyCss', css: this.getCss() });
	}

	dispose() {
		if (this.rehighlightTimer) {
			clearTimeout(this.rehighlightTimer);
		}
		this.disposables.forEach((d) => d.dispose());
	}
}
