import { StateEffect, type EditorState } from '@codemirror/state';

/**
 * True if the caret sits on a line spanned by [from, to] — the condition that
 * makes an inline construct (a heading's `#`, `**bold**`'s asterisks, a
 * blockquote's `>`) give way to its raw Markdown.
 *
 * A selection counts when it actually overlaps [from, to] — dragging across an
 * image's `](url)` is a request to select that text, so the source has to be
 * there to select. A selection that merely *ends* on one of the range's lines
 * without covering any of it does not: that is a sweep passing through, and
 * revealing on it would reflow the text under the pointer mid-drag.
 *
 * This is deliberately never consulted by a "図" block — a table, a diagram, or
 * frontmatter. Those change appearance too drastically for a cursor-driven
 * toggle to be predictable (the document opening with one at position 0, a
 * search match landing inside one, would silently flip it to source), so they
 * switch only through their own explicit button — see `isBlockRevealed` below.
 */
export function cursorTouchesRange(state: EditorState, from: number, to: number): boolean {
	const startLine = state.doc.lineAt(Math.min(from, state.doc.length)).number;
	const endLine = state.doc.lineAt(Math.min(to, state.doc.length)).number;
	for (const range of state.selection.ranges) {
		if (range.empty) {
			const headLine = state.doc.lineAt(range.head).number;
			if (headLine >= startLine && headLine <= endLine) return true;
			continue;
		}
		// A non-empty selection reveals only what it actually covers. Touching at a
		// single point (`range.to === from`) is adjacency, not overlap.
		if (range.from < to && range.to > from) return true;
	}
	return false;
}

/**
 * Character-precise sibling of `cursorTouchesRange`, for an inline construct
 * that shares its line with unrelated content — a list item's marker, or an
 * emphasis/strikethrough run inside a longer paragraph.
 *
 * `cursorTouchesRange`'s line-level check is right for a heading (the `#` is
 * the only thing on its line, so "caret on this line" and "caret in this
 * construct" are the same question) but wrong here: a caret anywhere else on
 * a list item's line — typing at its end, editing bold text further along —
 * is not a request to see that item's raw `-`, yet the line-level check
 * answered yes regardless of where on the line the caret actually was. The
 * same held for `**`/`~~`: editing plain text elsewhere on the same line
 * revealed them too.
 *
 * An empty caret counts only when it sits inside [from, to] or exactly at
 * either edge — the position a mouse click or Home reaches to edit the
 * construct itself. A non-empty selection reuses the overlap test
 * `cursorTouchesRange` uses for one; dragging is already precise by nature.
 */
export function inlineCursorTouchesRange(state: EditorState, from: number, to: number): boolean {
	for (const range of state.selection.ranges) {
		if (range.empty) {
			if (range.head >= from && range.head <= to) return true;
			continue;
		}
		if (range.from < to && range.to > from) return true;
	}
	return false;
}

/**
 * Start positions of "図" blocks — tables, diagrams (Mermaid/draw.io), and
 * frontmatter — currently switched to raw Markdown/YAML view via their own
 * button.
 *
 * Every other construct in this editor (headings, emphasis, lists, quotes,
 * inline code, links, images) toggles by where the caret happens to be —
 * `cursorTouchesRange` / `inlineCursorTouchesRange` above. A "図" block is
 * different: it replaces itself with a genuinely different-looking widget
 * (a `<table>`, a rendered diagram, a key/value list), not just a styled span
 * of the same text, so a caret landing on its lines by accident — the
 * document opening with one at position 0, a search match inside one, Tab
 * hopping between table cells — must never flip it to source, and moving the
 * caret away afterward must never flip it back either. Only the block's own
 * `</>` button reveals it, and only its own "back" button renders it again.
 *
 * Keyed on the block's start position alone. That position is stable for as
 * long as the block exists (an edit inside it, or elsewhere in the document,
 * never moves where it *starts*), which is not true of its end — see the
 * history of bugs this replaced, all rooted in a stale or momentarily-wrong
 * end position being used as part of a range key instead.
 */
const revealedBlockStarts = new Set<number>();

/** Marks whether the "図" block starting at `blockFrom` is showing raw source. */
export function setBlockRevealed(blockFrom: number, revealed: boolean): void {
	if (revealed) revealedBlockStarts.add(blockFrom);
	else revealedBlockStarts.delete(blockFrom);
}

/** Whether the "図" block starting at `blockFrom` is showing raw source. */
export function isBlockRevealed(blockFrom: number): boolean {
	return revealedBlockStarts.has(blockFrom);
}

/** Test seam: clears the remembered explicit-reveal state. */
export function clearBlockRevealedForTesting(): void {
	revealedBlockStarts.clear();
}

/**
 * Dispatched alongside a transaction that changes `revealedBlockStarts`
 * (see `setBlockRevealed`), so that state — being plain module state, not
 * part of `EditorState` — has a way to tell CodeMirror a rebuild is needed.
 * `blockDecorationsField` and `livePreviewPlugin` both watch for it.
 */
export const blockRevealChanged = StateEffect.define<null>();
