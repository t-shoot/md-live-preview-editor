import { describe, it, expect } from 'vitest';
import { EditorState, EditorSelection } from '@codemirror/state';
import { cursorTouchesRange } from './cmUtils';
import {
	searchRevealExtension,
	searchRowFor,
	selectionIsSearchMatch,
	setSearchSelection,
} from './searchReveal';

const DOC = 'above\n| a | b |\n|---|---|\n| 1 | 2 |\nbelow\n';

function stateWith(anchor: number, head = anchor): EditorState {
	return EditorState.create({
		doc: DOC,
		selection: { anchor, head },
		extensions: [searchRevealExtension],
	});
}

/** The table block spans lines 2-4 of DOC. */
function tableRange(state: EditorState): { from: number; to: number } {
	return { from: state.doc.line(2).from, to: state.doc.line(4).to };
}

/** Applies the search-match effect the way a search command does. */
function markAsMatch(state: EditorState): EditorState {
	return state.update({ effects: setSearchSelection.of(true) }).state;
}

describe('selectionIsSearchMatch', () => {
	it('is false for a fresh state', () => {
		expect(selectionIsSearchMatch(stateWith(0))).toBe(false);
	});

	it('is true once a search command marks the selection', () => {
		const state = markAsMatch(stateWith(8, 14));
		expect(selectionIsSearchMatch(state)).toBe(true);
	});

	it('clears when the selection moves on its own', () => {
		const marked = markAsMatch(stateWith(8, 14));
		const moved = marked.update({ selection: { anchor: 0 } }).state;
		expect(selectionIsSearchMatch(moved)).toBe(false);
	});

	it('survives an edit, so a replacement stays revealed', () => {
		const marked = markAsMatch(stateWith(8, 14));
		const edited = marked.update({ changes: { from: 0, to: 0, insert: 'x' } }).state;
		expect(selectionIsSearchMatch(edited)).toBe(true);
	});

	it('clears when explicitly unset', () => {
		const marked = markAsMatch(stateWith(8, 14));
		const cleared = marked.update({ effects: setSearchSelection.of(false) }).state;
		expect(selectionIsSearchMatch(cleared)).toBe(false);
	});
});

describe('cursorTouchesRange with a search match', () => {
	// `tableRange` below just supplies a convenient, arbitrary [from, to) span —
	// a table's own reveal no longer goes through `cursorTouchesRange` at all
	// (see `isBlockRevealed` in cmUtils.ts: a table, like every "図" block,
	// switches only through its own button, a search match inside it included).
	// What is still under test here is the shared inline mechanism itself —
	// the one headings, bold text, and other "一般的な文章" constructs use.

	it('reveals the range when the selection is a search match inside it', () => {
		const plain = stateWith(0);
		const { from, to } = tableRange(plain);
		const state = markAsMatch(stateWith(from + 2, from + 3));
		expect(cursorTouchesRange(state, from, to)).toBe(true);
	});

	it('leaves a block alone when the match is outside it', () => {
		const plain = stateWith(0);
		const { from, to } = tableRange(plain);
		const state = markAsMatch(stateWith(0, 5));
		expect(cursorTouchesRange(state, from, to)).toBe(false);
	});

	it('reveals for a multi-cursor search selection touching the block', () => {
		const plain = stateWith(0);
		const { from, to } = tableRange(plain);
		const base = EditorState.create({
			doc: DOC,
			selection: EditorSelection.create([
				EditorSelection.range(0, 5),
				EditorSelection.range(from + 2, from + 3),
			]),
			// A state keeps more than one range only when an extension allows it,
			// which is what Mod-d's multi-cursor search relies on.
			extensions: [searchRevealExtension, EditorState.allowMultipleSelections.of(true)],
		});
		expect(base.selection.ranges).toHaveLength(2);
		expect(cursorTouchesRange(markAsMatch(base), from, to)).toBe(true);
	});

	it('keeps an empty caret working when no search is active', () => {
		const state = stateWith(0);
		const { from, to } = tableRange(state);
		expect(cursorTouchesRange(state, from, to)).toBe(false);
		const inside = stateWith(from + 2);
		expect(cursorTouchesRange(inside, from, to)).toBe(true);
	});
});

describe('cursorTouchesRange for an inline image', () => {
	// `![alt](assets/pic.png)` mid-paragraph: the reported case where searching
	// for part of the URL jumped to the image but left it rendered, so the URL
	// could not be edited.
	const IMG_DOC = 'before ![alt](assets/pic.png) after\n';
	const imgFrom = IMG_DOC.indexOf('![');
	const imgTo = IMG_DOC.indexOf(')') + 1;

	function imgState(anchor: number, head = anchor): EditorState {
		return EditorState.create({
			doc: IMG_DOC,
			selection: { anchor, head },
			extensions: [searchRevealExtension],
		});
	}

	it('reveals the image when a search match lands on its URL', () => {
		const urlAt = IMG_DOC.indexOf('assets/pic.png');
		const match = markAsMatch(imgState(urlAt, urlAt + 'assets'.length));
		expect(cursorTouchesRange(match, imgFrom, imgTo)).toBe(true);
	});

	it('also reveals it for a plain drag-select over the URL', () => {
		// Dragging to select the URL is how it gets copied or replaced, and it
		// cannot be selected while the image is covering it.
		const urlAt = IMG_DOC.indexOf('assets/pic.png');
		const swept = imgState(urlAt, urlAt + 'assets'.length);
		expect(cursorTouchesRange(swept, imgFrom, imgTo)).toBe(true);
	});

	it('leaves the image alone for a selection that stops before it', () => {
		const swept = imgState(0, imgFrom);
		expect(cursorTouchesRange(swept, imgFrom, imgTo)).toBe(false);
	});
});

describe('searchRowFor', () => {
	it('puts controls before the break in the find row', () => {
		expect(searchRowFor('next', false, false)).toBe('find');
		expect(searchRowFor(null, false, false)).toBe('find');
	});

	it('puts controls after the break in the replace row', () => {
		expect(searchRowFor('replace', false, true)).toBe('replace');
		expect(searchRowFor('replaceAll', false, true)).toBe('replace');
	});

	it('leaves the close button and the chevron on the panel', () => {
		// These belong to the widget, not to either row, so they keep their own
		// absolute positioning rather than joining a flex row.
		expect(searchRowFor('close', false, false)).toBe('widget');
		expect(searchRowFor('close', false, true)).toBe('widget');
		expect(searchRowFor(null, true, false)).toBe('widget');
	});
});
