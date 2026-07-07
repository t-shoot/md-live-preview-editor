import type { EditorState } from '@codemirror/state';

/** True if any selection range's head sits on a line between the lines spanned by [from, to]. */
export function cursorTouchesRange(state: EditorState, from: number, to: number): boolean {
	const startLine = state.doc.lineAt(Math.min(from, state.doc.length)).number;
	const endLine = state.doc.lineAt(Math.min(to, state.doc.length)).number;
	for (const range of state.selection.ranges) {
		const headLine = state.doc.lineAt(range.head).number;
		if (headLine >= startLine && headLine <= endLine) {
			return true;
		}
	}
	return false;
}
