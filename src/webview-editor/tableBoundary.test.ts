import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from './gfmTableFix';
import { deletionBelowTable } from './tableBoundary';
import { setBlockRevealed } from './cmUtils';

const TABLE = '| A | B |\n| --- | --- |\n| one | two |';

function stateFor(doc: string, head: number) {
	return EditorState.create({ doc, selection: { anchor: head }, extensions: [markdown({ extensions: GFM })] });
}

describe('Backspace below a rendered table', () => {
	it('keeps the required separator and moves to the line above the table', () => {
		const doc = 'Before.\n\n' + TABLE + '\n\nAfter.\n';
		const state = stateFor(doc, doc.indexOf('\n\nAfter.') + 1);
		const spec = deletionBelowTable(state);
		expect(spec).not.toBeNull();
		const result = state.update(spec!).state;
		expect(result.doc.toString()).toBe(doc);
		expect(result.selection.main.head).toBe('Before.\n'.length);
	});

	it('creates a writable line above a table at the start of the document', () => {
		const doc = TABLE + '\n\nAfter.\n';
		const state = stateFor(doc, TABLE.length + 1);
		const result = state.update(deletionBelowTable(state)!).state;
		expect(result.doc.toString()).toBe('\n' + doc);
		expect(result.selection.main.head).toBe(0);
	});

	it('keeps a following heading out of the last table row', () => {
		const doc = 'Before.\n\n' + TABLE + '\n# After\n';
		const state = stateFor(doc, doc.indexOf('# After'));
		const result = state.update(deletionBelowTable(state)!).state;
		expect(result.doc.toString()).toBe(doc);
		expect(result.selection.main.head).toBe('Before.\n'.length);
	});

	it('removes extra blank lines without merging following text into the table', () => {
		const doc = 'Before.\n\n' + TABLE + '\n\n\nAfter.\n';
		const state = stateFor(doc, doc.indexOf('\n\n\nAfter.') + 1);
		const result = state.update(deletionBelowTable(state)!).state;
		expect(result.doc.toString()).toBe('Before.\n\n' + TABLE + '\n\nAfter.\n');
	});

	it('removes the trailing empty line when the table ends the document', () => {
		const doc = 'Before.\n\n' + TABLE + '\n';
		const state = stateFor(doc, doc.length);
		const result = state.update(deletionBelowTable(state)!).state;
		expect(result.doc.toString()).toBe('Before.\n\n' + TABLE);
	});

	it('leaves ordinary text deletion and selection deletion to the default commands', () => {
		const state = stateFor('First\nSecond', 6);
		expect(deletionBelowTable(state)).toBeNull();
		const doc = TABLE + '\n\nAfter.';
		const selected = stateFor(doc, 0).update({ selection: { anchor: 0, head: doc.length } }).state;
		expect(deletionBelowTable(selected)).toBeNull();
		const multi = EditorState.create({ doc, selection: EditorSelection.create([
			EditorSelection.cursor(1), EditorSelection.cursor(TABLE.length + 1),
		]), extensions: [markdown({ extensions: GFM }), EditorState.allowMultipleSelections.of(true)] });
		expect(deletionBelowTable(multi)).toBeNull();
	});

	it('does not change raw table editing', () => {
		const state = stateFor(TABLE + '\n', TABLE.length + 1);
		setBlockRevealed(0, true);
		try { expect(deletionBelowTable(state)).toBeNull(); }
		finally { setBlockRevealed(0, false); }
	});
});
