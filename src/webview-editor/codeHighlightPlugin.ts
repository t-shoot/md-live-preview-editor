import { StateEffect, StateField, Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import type { CodeBlockTokens, CodeToken } from '../shared/messages';

export const setCodeTokens = StateEffect.define<CodeBlockTokens[]>();

export const codeTokensField = StateField.define<CodeBlockTokens[]>({
	create() {
		return [];
	},
	update(value, tr) {
		for (const effect of tr.effects) {
			if (effect.is(setCodeTokens)) {
				return effect.value;
			}
		}
		if (!tr.docChanged) {
			return value;
		}
		// Re-map existing token ranges through the edit so highlighting stays roughly
		// aligned until the debounced re-tokenization result arrives from the host.
		return value
			.map((block): CodeBlockTokens | null => {
				const from = tr.changes.mapPos(block.from, -1);
				const to = tr.changes.mapPos(block.to, 1);
				if (from >= to) return null;
				const tokens = block.tokens
					.map((t): CodeToken | null => {
						const tf = tr.changes.mapPos(t.from, -1);
						const tt = tr.changes.mapPos(t.to, 1);
						if (tf >= tt) return null;
						return { from: tf, to: tt, style: t.style };
					})
					.filter((t): t is CodeToken => t !== null);
				return { from, to, tokens };
			})
			.filter((b): b is CodeBlockTokens => b !== null);
	},
});

function buildDecorations(view: EditorView): DecorationSet {
	const blocks = view.state.field(codeTokensField);
	const decorations: Range<Decoration>[] = [];
	for (const { from: viewFrom, to: viewTo } of view.visibleRanges) {
		for (const block of blocks) {
			if (block.to < viewFrom || block.from > viewTo) continue;
			for (const token of block.tokens) {
				if (token.to <= token.from) continue;
				decorations.push(Decoration.mark({ attributes: { style: token.style } }).range(token.from, token.to));
			}
		}
	}
	return Decoration.set(decorations, true);
}

export const codeHighlightPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			const tokensChanged = update.transactions.some((tr) => tr.effects.some((e) => e.is(setCodeTokens)));
			if (update.docChanged || update.viewportChanged || tokensChanged) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

export const codeHighlightExtension = [codeTokensField, codeHighlightPlugin];
