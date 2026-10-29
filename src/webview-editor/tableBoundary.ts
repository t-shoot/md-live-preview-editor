import { type ChangeSpec, type EditorState, type TransactionSpec } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { alignedBlockRange } from './livePreviewPlugin';
import { isBlockRevealed } from './cmUtils';
import { detectFrontmatter } from './frontmatterWidget';

/** Keep Backspace from parking the document caret at a rendered table's edge. */
export function deletionBelowTable(state: EditorState): TransactionSpec | null {
	if (state.readOnly || state.selection.ranges.length !== 1 || !state.selection.main.empty) return null;
	const { head } = state.selection.main;
	const line = state.doc.lineAt(head);
	if (line.number === 1 || head !== line.from) return null;
	const previous = state.doc.line(line.number - 1);
	let node = syntaxTree(state).resolveInner(previous.to, -1);
	while (node.name !== 'Table' && node.parent) node = node.parent;
	if (node.name !== 'Table' || node.to !== previous.to) return null;
	const range = alignedBlockRange(state, node.from, node.to);
	if (!range || isBlockRevealed(range.from)) return null;
	const frontmatter = detectFrontmatter(state);
	if (frontmatter && range.to <= frontmatter.to) return null;
	const firstLine = state.doc.lineAt(range.from);
	const changes: ChangeSpec[] = [];
	// Keep the final separator before following text: removing it can make
	// Markdown parse that text as another table row. Extra blank lines and a
	// trailing empty line at EOF can safely be removed.
	if (line.text === '' && (line.number === state.doc.lines || state.doc.line(line.number + 1).text.trim() === '')) {
		changes.push({ from: head - 1, to: head });
	}
	let anchor = 0;
	if (firstLine.number > 1) anchor = state.doc.line(firstLine.number - 1).to;
	else changes.unshift({ from: 0, insert: '\n' });
	return { changes, selection: { anchor }, scrollIntoView: true, userEvent: 'delete.backward' };
}

export function backspaceBelowTable(view: EditorView): boolean {
	const transaction = deletionBelowTable(view.state);
	if (!transaction) return false;
	view.dispatch(transaction);
	return true;
}
