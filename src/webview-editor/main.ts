import { EditorState, Annotation, type Extension, ChangeSet } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import { livePreviewPlugin, createLinkClickHandler } from './livePreviewPlugin';
import { codeHighlightExtension, setCodeTokens } from './codeHighlightPlugin';
import { blockDecorationsField } from './blockDecorations';
import { detectFrontmatter } from './frontmatterWidget';
import { postToHost, onHostMessage } from './vscodeApi';
import { adaptMarkdownCss } from '../shared/cssAdapter';
import type { TextChange } from '../shared/messages';

const remoteChange = Annotation.define<boolean>();
const FLUSH_DEBOUNCE_MS = 250;

let view: EditorView | undefined;
let baseVersion = 0;
let pending: ChangeSet | null = null;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

function flush() {
	flushTimer = undefined;
	if (!view || !pending || pending.empty) {
		pending = null;
		return;
	}
	const changes: TextChange[] = [];
	pending.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
		changes.push({ from: fromA, to: toA, insert: inserted.toString() });
	});
	pending = null;
	postToHost({ type: 'edit', baseVersion, changes });
}

function scheduleFlush() {
	if (flushTimer) clearTimeout(flushTimer);
	flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

function flushNow() {
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = undefined;
	}
	flush();
}

function applyUserCss(css: string) {
	let styleEl = document.getElementById('mlp-user-css') as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = document.createElement('style');
		styleEl.id = 'mlp-user-css';
		document.head.appendChild(styleEl);
	}
	styleEl.textContent = adaptMarkdownCss(css);
}

function createExtensions(): Extension[] {
	return [
		markdown({ extensions: GFM }),
		livePreviewPlugin,
		blockDecorationsField,
		codeHighlightExtension,
		createLinkClickHandler((href) => postToHost({ type: 'openLink', href })),
		keymap.of([
			// Flush any not-yet-sent keystrokes before asking the host to undo/redo —
			// otherwise the host's document is missing the latest edits when it acts,
			// undoing the wrong change and leaving the webview's local text duplicated
			// relative to what ends up in the file.
			{ key: 'Mod-z', run: () => { flushNow(); postToHost({ type: 'undo' }); return true; } },
			{ key: 'Mod-y', run: () => { flushNow(); postToHost({ type: 'redo' }); return true; } },
			{ key: 'Mod-Shift-z', run: () => { flushNow(); postToHost({ type: 'redo' }); return true; } },
			indentWithTab,
			...defaultKeymap,
		]),
		EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;
			const isRemote = update.transactions.some((tr) => tr.annotation(remoteChange));
			if (isRemote) return;
			pending = pending ? pending.compose(update.changes) : update.changes;
			scheduleFlush();
		}),
		EditorView.domEventHandlers({
			blur: () => flushNow(),
		}),
		EditorView.lineWrapping,
	];
}

// A fresh EditorState's selection defaults to position 0 — i.e. line 1 — which
// is exactly where a leading frontmatter block's own range starts. Left as-is,
// `cursorTouchesRange` would read that default as "the cursor is touching the
// frontmatter block" and keep it as raw source on every load, never rendering
// the table until the user happened to move the cursor away first. Placing the
// initial selection just past the block (only when one is actually present)
// avoids that without touching the general cursor-reveals-source behavior.
// `fm.to` is the *end of the closing "---" line itself* (correct for the
// decoration range), so it's still on that line — the anchor must go one
// further, past its line break, to actually land outside the block.
function initialStateFor(text: string): EditorState {
	const state = EditorState.create({ doc: text, extensions: createExtensions() });
	const fm = detectFrontmatter(state);
	if (!fm) return state;
	const anchor = Math.min(fm.to + 1, state.doc.length);
	return state.update({ selection: { anchor } }).state;
}

function createView(text: string) {
	const root = document.getElementById('mlp-root')!;
	view = new EditorView({
		state: initialStateFor(text),
		parent: root,
	});
}

function resetView(text: string) {
	if (!view) {
		createView(text);
		return;
	}
	pending = null;
	if (flushTimer) {
		clearTimeout(flushTimer);
		flushTimer = undefined;
	}
	view.setState(initialStateFor(text));
}

onHostMessage((message) => {
	switch (message.type) {
		case 'init':
			baseVersion = message.version;
			applyUserCss(message.css);
			resetView(message.text);
			break;
		case 'ackEdit':
			baseVersion = message.version;
			break;
		case 'externalUpdate': {
			if (!view) return;
			pending = null;
			if (flushTimer) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			view.dispatch({
				changes: message.changes,
				annotations: remoteChange.of(true),
			});
			baseVersion = message.version;
			break;
		}
		case 'codeTokens':
			view?.dispatch({ effects: setCodeTokens.of(message.blocks), annotations: remoteChange.of(true) });
			break;
		case 'applyCss':
			applyUserCss(message.css);
			break;
	}
});

postToHost({ type: 'ready' });
