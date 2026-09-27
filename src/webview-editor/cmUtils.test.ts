import { describe, it, expect, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { cursorTouchesRange, inlineCursorTouchesRange, isBlockRevealed, setBlockRevealed, clearBlockRevealedForTesting } from './cmUtils';

const DOC = 'above\n| a | b |\n|---|---|\n| 1 | 2 |\nbelow\n';

/** Range of the table block in DOC (lines 2-4) — used as a convenient, arbitrary span. */
function tableRange(state: EditorState): { from: number; to: number } {
	return { from: state.doc.line(2).from, to: state.doc.line(4).to };
}

function stateWithSelection(anchor: number, head = anchor): EditorState {
	return EditorState.create({ doc: DOC, selection: { anchor, head } });
}

describe('cursorTouchesRange', () => {
	it('is true for a caret on a line inside the range', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const inside = state.doc.line(3).from + 2;
		expect(cursorTouchesRange(stateWithSelection(inside), from, to)).toBe(true);
	});

	it('is false for a caret outside the range', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		expect(cursorTouchesRange(stateWithSelection(1), from, to)).toBe(false);
	});

	// Inline constructs give up their source to a drag-select: dragging across
	// an image's `](url)` is how you select that URL, and it cannot be selected
	// while it is hidden.
	it('reveals for a selection that overlaps the range', () => {
		const state = stateWithSelection(0);
		const { from, to } = tableRange(state);
		const head = state.doc.line(3).from + 2;
		expect(cursorTouchesRange(stateWithSelection(0, head), from, to)).toBe(true);
	});

	it('ignores a selection that stops short of the range', () => {
		const state = stateWithSelection(0);
		const { from } = tableRange(state);
		// Ends exactly where the range starts: adjacency, not overlap.
		expect(cursorTouchesRange(stateWithSelection(0, from), from, from + 4)).toBe(false);
	});
});

describe('inlineCursorTouchesRange', () => {
	// A list item's marker ("- ", positions 0-2) sharing a line with the rest
	// of the item's text — the shape that made `cursorTouchesRange`'s
	// line-level check reveal a list item's raw "-" (or a bold run's "**")
	// merely because the caret was elsewhere on the same line (regression).
	const DOC_LIST = '- item one text\nnext\n';

	it('is true for a caret exactly at the range (touching the marker itself)', () => {
		expect(inlineCursorTouchesRange(stateWithSelection(0), 0, 1)).toBe(true); // at `from`
		expect(inlineCursorTouchesRange(stateWithSelection(1), 0, 1)).toBe(true); // at `to`
	});

	it('is false for a caret elsewhere on the same line (regression)', () => {
		const state = EditorState.create({ doc: DOC_LIST, selection: { anchor: 10 } }); // inside "item one"
		expect(inlineCursorTouchesRange(state, 0, 1)).toBe(false);
	});

	it('reveals for a selection that overlaps the range, like cursorTouchesRange', () => {
		const state = EditorState.create({ doc: DOC_LIST, selection: { anchor: 0, head: 5 } });
		expect(inlineCursorTouchesRange(state, 0, 1)).toBe(true);
	});

	it('ignores a selection that stops short of the range (adjacency, not overlap)', () => {
		const state = EditorState.create({ doc: DOC_LIST, selection: { anchor: 1, head: 5 } });
		expect(inlineCursorTouchesRange(state, 0, 1)).toBe(false);
	});
});

describe('isBlockRevealed / setBlockRevealed', () => {
	// The whole point of this pair: a "図" block (table, diagram, frontmatter)
	// switches only through its own button, never by where the caret is. So
	// unlike `cursorTouchesRange`, this state takes no `EditorState` at all —
	// it is plain module state, keyed on a block's start position alone (stable
	// across an edit inside the block, unlike its end — see the comment above
	// `revealedBlockStarts` in cmUtils.ts for the bug history that shaped this).
	afterEach(() => {
		clearBlockRevealedForTesting();
	});

	it('is false for a position nothing has touched', () => {
		expect(isBlockRevealed(42)).toBe(false);
	});

	it('becomes true once set, independent of any caret or selection', () => {
		setBlockRevealed(42, true);
		expect(isBlockRevealed(42)).toBe(true);
	});

	it('clears when set back to false', () => {
		setBlockRevealed(42, true);
		setBlockRevealed(42, false);
		expect(isBlockRevealed(42)).toBe(false);
	});

	it('does not leak to a different block', () => {
		setBlockRevealed(42, true);
		expect(isBlockRevealed(43)).toBe(false);
	});

	it('clearBlockRevealedForTesting clears every block at once', () => {
		setBlockRevealed(1, true);
		setBlockRevealed(2, true);
		clearBlockRevealedForTesting();
		expect(isBlockRevealed(1)).toBe(false);
		expect(isBlockRevealed(2)).toBe(false);
	});
});
