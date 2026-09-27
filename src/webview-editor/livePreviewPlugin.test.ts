import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
// The app parses with a patched GFM that lets an indented table interrupt a
// list item's paragraph (see gfmTableFix.ts); the nested-table tests below
// need it. The stock `GFM` above is kept for the tests that predate it.
import { GFM as AppGFM } from './gfmTableFix';
import { ensureSyntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { readCells, resolveImageSrc, blankLineAfter, blockReplacedLines } from './livePreviewPlugin';
import { blockDecorationsField } from './blockDecorations';
import { setBlockRevealed, clearBlockRevealedForTesting } from './cmUtils';

/** Builds a 2-row GFM table (header + one data row) from a list of cell values. */
function tableFor(cells: string[]): string {
	const header = cells.map((_, i) => `h${i}`).join(' | ');
	const separator = cells.map(() => '---').join(' | ');
	const row = cells.join(' | ');
	return `| ${header} |\n| ${separator} |\n| ${row} |`;
}

/** Parses markdown text (via the same GFM-extended parser the app uses) and
 * collects its TableHeader/TableRow nodes in document order, exactly as
 * `buildTableWidget` does in production. */
function parseTable(markdownText: string): { state: EditorState; rows: SyntaxNode[] } {
	const state = EditorState.create({ doc: markdownText, extensions: [markdown({ extensions: GFM })] });
	const tree = ensureSyntaxTree(state, state.doc.length, 5000);
	if (!tree) throw new Error('syntax tree did not finish parsing in time');
	const rows: SyntaxNode[] = [];
	tree.iterate({
		enter(node) {
			if (node.name === 'TableHeader' || node.name === 'TableRow') rows.push(node.node);
		},
	});
	return { state, rows };
}

// Domain generator (PBT-07): alphanumeric tokens, an escaped-pipe variant
// (a literal "\|" inside one cell, which GFM table syntax keeps as part of
// the cell rather than a column separator), and the empty string — the exact
// boundary value that caused the empty-middle-cell regression this test suite
// guards against (see aidlc-docs history, Cycle 1).
const cellToken = fc.stringMatching(/^[a-zA-Z0-9]{1,8}$/);
const cellWithEscapedPipe = fc.tuple(cellToken, cellToken).map(([a, b]) => `${a}\\|${b}`);
const cellText = fc.oneof(cellToken, cellWithEscapedPipe, fc.constant(''));

describe('readCells', () => {
	it('keeps an empty middle cell in place instead of shifting later columns left (regression)', () => {
		const { state, rows } = parseTable(tableFor(['a', '', 'c']));
		expect(rows).toHaveLength(2); // [TableHeader, TableRow]
		expect(readCells(state, rows[1])).toEqual(['a', '', 'c']);
	});

	it('keeps multiple adjacent empty cells in place (regression)', () => {
		const { state, rows } = parseTable(tableFor(['', '', 'z']));
		expect(readCells(state, rows[1])).toEqual(['', '', 'z']);
	});

	it('never drops or shifts cells, even when several are empty (PBT-03 invariant)', () => {
		fc.assert(
			fc.property(fc.array(cellText, { minLength: 2, maxLength: 6 }), (cells) => {
				const { state, rows } = parseTable(tableFor(cells));
				expect(readCells(state, rows[1])).toHaveLength(cells.length);
			}),
		);
	});

	it('round-trips cell content through table markup, including empty and pipe-escaped cells (PBT-02)', () => {
		fc.assert(
			fc.property(fc.array(cellText, { minLength: 2, maxLength: 6 }), (cells) => {
				const { state, rows } = parseTable(tableFor(cells));
				expect(readCells(state, rows[1])).toEqual(cells);
			}),
		);
	});
});

describe('resolveImageSrc', () => {
	const baseUri = 'https://file+.vscode-resource.vscode-cdn.net/c%3A/work/repo/notes/';

	it('leaves absolute URLs (https, data) unchanged regardless of baseUri', () => {
		expect(resolveImageSrc('https://picsum.photos/id/1015/480/270', baseUri)).toBe(
			'https://picsum.photos/id/1015/480/270',
		);
		expect(resolveImageSrc('data:image/png;base64,AAAA', baseUri)).toBe('data:image/png;base64,AAAA');
	});

	it('resolves a relative path against baseUri (regression: pasted images not rendering)', () => {
		expect(resolveImageSrc('assets/foo.png', baseUri)).toBe(
			'https://file+.vscode-resource.vscode-cdn.net/c%3A/work/repo/notes/assets/foo.png',
		);
	});

	it('returns the src unchanged when no baseUri is set yet', () => {
		expect(resolveImageSrc('assets/foo.png', '')).toBe('assets/foo.png');
	});

	// Domain generator (PBT-07): realistic relative asset paths (no leading
	// slash, no scheme) alongside a fixed, realistic webview base URI.
	const relativePathArb = fc
		.array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/), { minLength: 1, maxLength: 3 })
		.map((segments) => segments.join('/'));

	it('always resolves a relative path to something starting with baseUri (PBT-03 invariant)', () => {
		fc.assert(
			fc.property(relativePathArb, (relPath) => {
				const resolved = resolveImageSrc(relPath, baseUri);
				expect(resolved.startsWith(baseUri)).toBe(true);
			}),
		);
	});
});

describe('blankLineAfter', () => {
	const stateFor = (doc: string) => EditorState.create({ doc });
	/** Offset of the end of `line` (1-based) — the value the helper returns. */
	const endOfLine = (doc: string, line: number) => stateFor(doc).doc.line(line).to;

	it('claims the blank line a paragraph is followed by', () => {
		const doc = 'テスト\n';
		expect(blankLineAfter(stateFor(doc), 3)).toBe(endOfLine(doc, 2));
	});

	it('claims the blank line separating two paragraphs', () => {
		const doc = 'one\n\ntwo';
		expect(blankLineAfter(stateFor(doc), 3)).toBe(endOfLine(doc, 2));
	});

	it('returns null at the end of the document (no line to claim)', () => {
		expect(blankLineAfter(stateFor('テスト'), 3)).toBeNull();
	});

	it('returns null when the next line has content', () => {
		// A soft-wrapped paragraph: the next line is already inside the block, so
		// `-last` reaches it through the normal range, not through this helper.
		expect(blankLineAfter(stateFor('one\ntwo'), 3)).toBeNull();
	});

	it('returns null when the next line is whitespace rather than empty', () => {
		// Trailing spaces are a hard line break in Markdown — that line still
		// carries content, so it is not a separator this may claim.
		expect(blankLineAfter(stateFor('one\n  \ntwo'), 3)).toBeNull();
	});

	it('never returns an offset outside the document', () => {
		fc.assert(
			fc.property(fc.stringMatching(/^[a-z\n ]{0,40}$/), (doc) => {
				const state = stateFor(doc);
				for (let pos = 0; pos <= state.doc.length; pos++) {
					const to = blankLineAfter(state, pos);
					if (to !== null) expect(to).toBeLessThanOrEqual(state.doc.length);
				}
			}),
		);
	});
});

/**
 * A table written directly under a list item's text — no blank line, indented
 * to the item's content column — parses into a `Table` nested inside the
 * `ListItem`. `blockDecorationsField` replaces that range with a rendered table
 * widget, but the `ListItem` branch of `buildDecorations` put a line decoration
 * on *every* line the item spans, the table's lines included. CodeMirror
 * discards a block-replacing decoration overlapping a line decoration, so the
 * widget was dropped and the table stayed raw pipe-separated text — while the
 * identical table at the top level rendered fine.
 *
 * `blockReplacedLines` marks exactly the lines a block widget will cover so
 * they can be skipped, and must stay in step with `buildBlockDecorations`:
 * skipping too little brings the bug back, skipping too much strips list
 * styling from lines that render normally.
 */
function skippedLines(markdownText: string): number[] {
	const state = EditorState.create({
		doc: markdownText,
		extensions: [markdown({ extensions: AppGFM })],
		// Parked past every block under test: a cursor touching a block reverts it
		// to raw source by design, which would mask what these tests check.
		selection: { anchor: markdownText.length },
	});
	const tree = ensureSyntaxTree(state, state.doc.length, 5000);
	if (!tree) throw new Error('syntax tree did not finish parsing in time');
	const all = new Set<number>();
	tree.iterate({
		enter(node) {
			if (node.name !== 'ListItem') return;
			for (const line of blockReplacedLines(state, node.node)) all.add(line);
		},
	});
	return [...all].sort((a, b) => a - b);
}

describe('blockReplacedLines', () => {
	it('cedes every line of a table nested under a list item', () => {
		expect(skippedLines('- weight:\n  | act | pt |\n  |---|---|\n  | a | 1 |\n  | b | 2 |\n')).toEqual([2, 3, 4, 5]);
	});

	it('keeps the list item own text line decorated', () => {
		expect(skippedLines('- weight:\n  | act | pt |\n  |---|---|\n  | a | 1 |\n')).not.toContain(1);
	});

	it('cedes nothing for lists with no nested table', () => {
		expect(skippedLines('- one\n- two\n- three\n')).toEqual([]);
		expect(skippedLines('- a\n  - b\n  - c\n')).toEqual([]);
		expect(skippedLines('- a\n\n  continued text\n')).toEqual([]);
		expect(skippedLines('- d:\n  ```js\n  const x = 1;\n  ```\n')).toEqual([]);
	});

	it('cedes nothing while the table is explicitly switched to raw source', () => {
		// A "図" block like this nested table only shows raw source once its own
		// `</>` button set `isBlockRevealed` — the caret merely sitting on one of
		// its lines (once how this test drove the same scenario) no longer has
		// any effect at all. See `isBlockRevealed` in cmUtils.ts.
		const doc = '- weight:\n  | act | pt |\n  |---|---|\n  | a | 1 |\n';
		const state = EditorState.create({
			doc,
			extensions: [markdown({ extensions: AppGFM })],
		});
		const tree = ensureSyntaxTree(state, state.doc.length, 5000);
		if (!tree) throw new Error('syntax tree did not finish parsing in time');
		const tableLineStart = state.doc.lineAt(doc.indexOf('| act')).from;
		setBlockRevealed(tableLineStart, true);
		try {
			const all = new Set<number>();
			tree.iterate({
				enter(node) {
					if (node.name !== 'ListItem') return;
					for (const line of blockReplacedLines(state, node.node)) all.add(line);
				},
			});
			// No widget replaces those lines, so they must keep their list styling.
			expect([...all]).toEqual([]);
		} finally {
			clearBlockRevealedForTesting();
		}
	});

	it('agrees with the block decorations actually produced for the same document', () => {
		// The real guarantee: what `blockDecorationsField` replaces is exactly what
		// the line-decoration pass skips. Drift either way is the bug.
		const doc = '- 重みづけ:\n  | 行動 | 経験値 |\n  |---|---|\n  | 配達1個 | 1pt |\n';
		const state = EditorState.create({
			doc,
			extensions: [markdown({ extensions: AppGFM }), blockDecorationsField],
			selection: { anchor: doc.length },
		});
		ensureSyntaxTree(state, state.doc.length, 5000);

		const replaced = new Set<number>();
		const iter = state.field(blockDecorationsField).iter();
		while (iter.value) {
			const first = state.doc.lineAt(iter.from).number;
			const last = state.doc.lineAt(iter.to).number;
			for (let n = first; n <= last; n++) replaced.add(n);
			iter.next();
		}

		expect(replaced.size).toBeGreaterThan(0);
		expect(skippedLines(doc)).toEqual([...replaced].sort((a, b) => a - b));
	});
});

/**
 * End-to-end check across every indentation a table under a list item can
 * realistically carry. `blockReplacedLines` above verifies the line-decoration
 * side in isolation; this verifies the thing the user actually sees — that a
 * block-replacing table widget is emitted at all — for each variant.
 *
 * Zero and one-space indents fall short of the item's content column, so CommonMark
 * puts the table outside the list entirely. It still renders as a table, which is
 * what matters here; only its nesting differs.
 */
describe('nested table block decorations across indent styles', () => {
	const variants: [string, string][] = [
		['no indent (table leaves the list)', '- w:\n| h | v |\n|---|---|\n| a | 1 |\n'],
		['one space', '- w:\n | h | v |\n |---|---|\n | a | 1 |\n'],
		['two spaces (content column)', '- w:\n  | h | v |\n  |---|---|\n  | a | 1 |\n'],
		['three spaces', '- w:\n   | h | v |\n   |---|---|\n   | a | 1 |\n'],
		['tab', '- w:\n\t| h | v |\n\t|---|---|\n\t| a | 1 |\n'],
		['ordered list', '1. w:\n   | h | v |\n   |---|---|\n   | a | 1 |\n'],
	];

	for (const [name, doc] of variants) {
		it(`renders a table widget with ${name}`, () => {
			const state = EditorState.create({
				doc,
				extensions: [markdown({ extensions: AppGFM }), blockDecorationsField],
				selection: { anchor: doc.length },
			});
			ensureSyntaxTree(state, state.doc.length, 5000);

			const covered: number[] = [];
			const iter = state.field(blockDecorationsField).iter();
			while (iter.value) {
				const first = state.doc.lineAt(iter.from).number;
				const last = state.doc.lineAt(iter.to).number;
				for (let n = first; n <= last; n++) covered.push(n);
				iter.next();
			}
			// The three table lines (2-4) are replaced by the rendered widget; the
			// list item's own text line (1) is not.
			expect(covered).toEqual([2, 3, 4]);
		});
	}
});
