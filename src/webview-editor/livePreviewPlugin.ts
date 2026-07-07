import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import type { Range, EditorState } from '@codemirror/state';
import type { SyntaxNode, SyntaxNodeRef } from '@lezer/common';
import { cursorTouchesRange } from './cmUtils';
import { detectFrontmatter } from './frontmatterWidget';

const HEADING_LINE_CLASS: Record<string, string> = {
	ATXHeading1: 'mlp-line-h1',
	ATXHeading2: 'mlp-line-h2',
	ATXHeading3: 'mlp-line-h3',
	ATXHeading4: 'mlp-line-h4',
	ATXHeading5: 'mlp-line-h5',
	ATXHeading6: 'mlp-line-h6',
};

export function isLineAligned(state: EditorState, from: number, to: number): boolean {
	return from === state.doc.lineAt(from).from && to === state.doc.lineAt(to).to;
}

class ImageWidget extends WidgetType {
	constructor(
		private readonly src: string,
		private readonly alt: string,
	) {
		super();
	}
	eq(other: ImageWidget): boolean {
		return other.src === this.src && other.alt === this.alt;
	}
	toDOM(): HTMLElement {
		const img = document.createElement('img');
		img.src = this.src;
		img.alt = this.alt;
		img.className = 'mlp-image';
		return img;
	}
}

// CodeMirror calibrates its "typical line height" estimate (used to figure out
// how far to move for one line on ArrowUp/ArrowDown, among other things) by
// measuring the first short, plain-text line it finds whose only DOM content is
// a single text node — see `measureTextSize` in @codemirror/view. A hidden
// marker built via a bare `Decoration.replace({})` leaves the rest of the line
// as exactly that: one plain text node. For a heading line (much taller than
// body text via font-size/padding/margin/border) that makes it eligible as the
// sample, poisoning the estimate for the whole document and causing
// ArrowUp/ArrowDown to overshoot by a line at a time once it walks past one.
// Backing every hidden marker with this zero-size widget instead gives the
// line an extra, non-text DOM child, which disqualifies it from that scan.
class HiddenMarkerWidget extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		return document.createElement('span');
	}
	get estimatedHeight(): number {
		return 0;
	}
}
const hiddenMarker = new HiddenMarkerWidget();
const hiddenMarkerDeco = Decoration.replace({ widget: hiddenMarker });

class BulletWidget extends WidgetType {
	eq(): boolean {
		return true;
	}
	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'mlp-bullet';
		span.textContent = '•';
		return span;
	}
}

class CheckboxWidget extends WidgetType {
	constructor(
		private readonly checked: boolean,
		private readonly markerFrom: number,
	) {
		super();
	}
	eq(other: CheckboxWidget): boolean {
		return other.checked === this.checked && other.markerFrom === this.markerFrom;
	}
	toDOM(view: EditorView): HTMLElement {
		const box = document.createElement('span');
		box.className = 'mlp-checkbox' + (this.checked ? ' mlp-checkbox-checked' : '');
		box.setAttribute('role', 'checkbox');
		box.setAttribute('aria-checked', String(this.checked));
		box.addEventListener('mousedown', (event) => {
			event.preventDefault();
			// The marker is "[ ]" / "[x]"; the state character sits at markerFrom + 1.
			const stateChar = view.state.sliceDoc(this.markerFrom + 1, this.markerFrom + 2);
			const insert = stateChar.toLowerCase() === 'x' ? ' ' : 'x';
			view.dispatch({ changes: { from: this.markerFrom + 1, to: this.markerFrom + 2, insert } });
		});
		return box;
	}
	ignoreEvent(): boolean {
		return false;
	}
}

// Render the common inline Markdown constructs inside a table cell — the rich
// TableWidget is a rendered DOM tree, not CodeMirror text, so the live-preview
// decorations don't reach it and cell content would otherwise show its raw
// `code`, **bold**, etc. markup. Emphasis is applied only to the runs *between*
// inline-code spans, since code spans are literal and must win.
function appendInlineEmphasis(parent: HTMLElement, text: string): void {
	const re = /\*\*([^*]+)\*\*|~~([^~]+)~~|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
		if (m[1] !== undefined) {
			const el = document.createElement('strong');
			el.className = 'mlp-strong';
			el.textContent = m[1];
			parent.appendChild(el);
		} else if (m[2] !== undefined) {
			const el = document.createElement('del');
			el.className = 'mlp-strikethrough';
			el.textContent = m[2];
			parent.appendChild(el);
		} else if (m[3] !== undefined) {
			const el = document.createElement('em');
			el.className = 'mlp-em';
			el.textContent = m[3];
			parent.appendChild(el);
		} else {
			const a = document.createElement('a');
			a.className = 'mlp-link';
			a.textContent = m[4];
			a.setAttribute('data-href', m[5]);
			parent.appendChild(a);
		}
		last = m.index + m[0].length;
	}
	if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
}

function renderCellInline(cell: HTMLElement, text: string): void {
	const codeRe = /`([^`]+)`/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = codeRe.exec(text))) {
		if (m.index > last) appendInlineEmphasis(cell, text.slice(last, m.index));
		const code = document.createElement('code');
		code.className = 'mlp-inline-code';
		code.textContent = m[1];
		cell.appendChild(code);
		last = m.index + m[0].length;
	}
	if (last < text.length) appendInlineEmphasis(cell, text.slice(last));
}

class TableWidget extends WidgetType {
	constructor(
		private readonly rows: string[][],
		private readonly headerRowCount: number,
	) {
		super();
	}
	eq(other: TableWidget): boolean {
		return JSON.stringify(other.rows) === JSON.stringify(this.rows) && other.headerRowCount === this.headerRowCount;
	}
	toDOM(view: EditorView): HTMLElement {
		const table = document.createElement('table');
		table.className = 'mlp-table';
		this.rows.forEach((cells, rowIndex) => {
			const tr = document.createElement('tr');
			for (const cellText of cells) {
				const cell = document.createElement(rowIndex < this.headerRowCount ? 'th' : 'td');
				renderCellInline(cell, cellText);
				tr.appendChild(cell);
			}
			table.appendChild(tr);
		});
		table.addEventListener('mousedown', (event) => {
			event.preventDefault();
			const pos = view.posAtDOM(table);
			view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
			view.focus();
		});
		return table;
	}
	ignoreEvent(): boolean {
		return false;
	}
}

function readCells(state: EditorState, rowNode: SyntaxNode): string[] {
	return rowNode.getChildren('TableCell').map((cell) => state.sliceDoc(cell.from, cell.to).trim());
}

export function buildTableWidget(state: EditorState, node: SyntaxNodeRef): TableWidget {
	const rows: string[][] = [];
	let headerRowCount = 0;
	for (const child of node.node.getChildren('TableHeader')) {
		rows.push(readCells(state, child));
		headerRowCount = rows.length;
	}
	for (const child of node.node.getChildren('TableRow')) {
		rows.push(readCells(state, child));
	}
	return new TableWidget(rows, headerRowCount);
}

/** True when the list item owning this mark is a GFM task item ("- [ ] ..."). */
function listItemIsTask(state: EditorState, listMark: SyntaxNodeRef): boolean {
	const line = state.doc.lineAt(listMark.from);
	const after = state.sliceDoc(listMark.to, line.to);
	return /^\s*\[[ xX]\]/.test(after);
}

function buildDecorations(view: EditorView): DecorationSet {
	const { state } = view;
	const { doc } = state;
	const decorations: Range<Decoration>[] = [];
	const seenReplace = new Set<string>();
	const seenLine = new Map<number, string>();
	const tree = syntaxTree(state);
	// blockDecorationsField renders the whole frontmatter block as its own
	// widget; skip it here too so this pass doesn't waste time computing
	// marks/line-classes for a range that block-level decoration will cover.
	const fm = detectFrontmatter(state);

	const pushReplace = (from: number, to: number, deco: Decoration) => {
		const key = `${from}:${to}`;
		if (seenReplace.has(key)) return;
		seenReplace.add(key);
		decorations.push(deco.range(from, to));
	};

	// A line can only carry one line decoration, so merge class names per line and
	// emit them all at the end (each exactly once, at the line start).
	const addLineClass = (lineFrom: number, cls: string) => {
		const existing = seenLine.get(lineFrom);
		seenLine.set(lineFrom, existing ? `${existing} ${cls}` : cls);
	};
	const addLineRange = (from: number, to: number, cls: (lineNumber: number, first: boolean, last: boolean) => string) => {
		const firstLine = doc.lineAt(from).number;
		const lastLine = doc.lineAt(to).number;
		for (let n = firstLine; n <= lastLine; n++) {
			addLineClass(doc.line(n).from, cls(n, n === firstLine, n === lastLine));
		}
	};

	for (const { from: rangeFrom, to: rangeTo } of view.visibleRanges) {
		tree.iterate({
			from: rangeFrom,
			to: rangeTo,
			enter: (node) => {
				if (fm && node.from < fm.to && node.to > fm.from) return false;
				const name = node.name;

				if (name in HEADING_LINE_CLASS) {
					addLineClass(doc.lineAt(node.from).from, HEADING_LINE_CLASS[name]);
					// Unconditionally plant a zero-size widget at the *end* of the heading
					// line, even while the cursor sits on it and the "#" marker is fully
					// visible. Otherwise, at the moment a heading line first mounts with
					// the cursor already on it (e.g. the very first line of the
					// document), its content is one plain, short, all-ASCII text node —
					// exactly what CodeMirror's height-oracle sampler looks for (see
					// HiddenMarkerWidget above) — and it gets poisoned before the user
					// ever moves the cursor away to trigger the HeaderMark-hiding path
					// below. Anchored at node.to (not node.from, where the HeaderMark's
					// own hidden-marker decoration starts) so the two never compete for
					// the same boundary position.
					decorations.push(Decoration.widget({ widget: hiddenMarker, side: 1 }).range(node.to));
					return; // descend so the HeaderMark ("#") gets hidden
				}

				switch (name) {
					case 'HeaderMark': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							const next = state.sliceDoc(node.to, node.to + 1);
							const to = next === ' ' ? node.to + 1 : node.to;
							// A plain replace (no widget) here: the heading line already
							// carries its own unconditional widget above, so it's never at
							// risk of being mistaken for a plain text line either way.
							pushReplace(node.from, to, Decoration.replace({}));
						}
						return;
					}
					case 'QuoteMark':
					case 'CodeMark':
					case 'CodeInfo': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							// Also swallow the single space after the marker so hidden markers
							// don't leave a dangling indent.
							const next = state.sliceDoc(node.to, node.to + 1);
							const to = next === ' ' ? node.to + 1 : node.to;
							pushReplace(node.from, to, hiddenMarkerDeco);
						}
						return;
					}
					case 'EmphasisMark':
					case 'StrikethroughMark': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							pushReplace(node.from, node.to, hiddenMarkerDeco);
						}
						return;
					}
					case 'StrongEmphasis':
						decorations.push(Decoration.mark({ tagName: 'strong', class: 'mlp-strong' }).range(node.from, node.to));
						return;
					case 'Emphasis':
						decorations.push(Decoration.mark({ tagName: 'em', class: 'mlp-em' }).range(node.from, node.to));
						return;
					case 'Strikethrough':
						decorations.push(Decoration.mark({ tagName: 'del', class: 'mlp-strikethrough' }).range(node.from, node.to));
						return;
					case 'InlineCode':
						decorations.push(Decoration.mark({ tagName: 'code', class: 'mlp-inline-code' }).range(node.from, node.to));
						return;
					case 'Paragraph':
						addLineRange(node.from, node.to, (_n, first, last) => {
							let cls = 'mlp-line-paragraph';
							if (first) cls += ' mlp-line-paragraph-first';
							if (last) cls += ' mlp-line-paragraph-last';
							return cls;
						});
						return;
					case 'ListItem':
						addLineRange(node.from, node.to, (_n, first, last) => {
							let cls = 'mlp-line-list';
							if (first) cls += ' mlp-line-list-first';
							if (last) cls += ' mlp-line-list-last';
							return cls;
						});
						return;
					case 'Blockquote':
						addLineRange(node.from, node.to, (_n, first, last) => {
							let cls = 'mlp-line-quote';
							if (first) cls += ' mlp-line-quote-first';
							if (last) cls += ' mlp-line-quote-last';
							return cls;
						});
						return; // descend to hide the ">" marks
					case 'ListMark': {
						if (listItemIsTask(state, node)) {
							// Task items render a checkbox from the TaskMarker; drop the bullet.
							if (!cursorTouchesRange(state, node.from, node.to)) {
								const next = state.sliceDoc(node.to, node.to + 1);
								pushReplace(node.from, next === ' ' ? node.to + 1 : node.to, hiddenMarkerDeco);
							}
							return;
						}
						const markText = state.sliceDoc(node.from, node.to);
						if (/^[-*+]$/.test(markText)) {
							if (!cursorTouchesRange(state, node.from, node.to)) {
								pushReplace(node.from, node.to, Decoration.replace({ widget: new BulletWidget() }));
							} else {
								decorations.push(Decoration.mark({ class: 'mlp-list-mark' }).range(node.from, node.to));
							}
						} else {
							// Ordered marker ("1.", "2)") — keep the number, just tint it.
							decorations.push(Decoration.mark({ class: 'mlp-list-mark' }).range(node.from, node.to));
						}
						return;
					}
					case 'TaskMarker': {
						if (!cursorTouchesRange(state, node.from, node.to)) {
							const checked = /[xX]/.test(state.sliceDoc(node.from, node.to));
							pushReplace(node.from, node.to, Decoration.replace({ widget: new CheckboxWidget(checked, node.from) }));
						}
						return;
					}
					case 'HorizontalRule':
						decorations.push(Decoration.mark({ class: 'mlp-hr' }).range(node.from, node.to));
						return;
					case 'FencedCode': {
						const infoNode = node.node.getChild('CodeInfo');
						const lang = infoNode ? state.sliceDoc(infoNode.from, infoNode.to).trim().toLowerCase() : '';
						const cursorAway = !cursorTouchesRange(state, node.from, node.to);
						if (lang === 'mermaid' && cursorAway && isLineAligned(state, node.from, node.to)) {
							// Rendered as a diagram by blockDecorationsField; skip entirely.
							return false;
						}
						addLineRange(node.from, node.to, (_n, first, last) => {
							let cls = 'mlp-line-code';
							if (first) cls += ' mlp-line-code-first';
							if (last) cls += ' mlp-line-code-last';
							return cls;
						});
						return; // descend to hide the ``` fence marks
					}
					case 'Link': {
						const marks = node.node.getChildren('LinkMark');
						if (marks.length < 2) return;
						const labelFrom = marks[0].to;
						const labelTo = marks[1].from;
						const urlNode = node.node.getChild('URL');
						const href = urlNode ? state.sliceDoc(urlNode.from, urlNode.to) : '';
						decorations.push(
							Decoration.mark({ tagName: 'a', class: 'mlp-link', attributes: { 'data-href': href } }).range(labelFrom, labelTo),
						);
						if (!cursorTouchesRange(state, node.from, node.to)) {
							if (labelFrom > node.from) pushReplace(node.from, labelFrom, hiddenMarkerDeco);
							if (node.to > labelTo) pushReplace(labelTo, node.to, hiddenMarkerDeco);
						}
						return false;
					}
					case 'Image': {
						const marks = node.node.getChildren('LinkMark');
						if (marks.length < 2) return;
						const altFrom = marks[0].to;
						const altTo = marks[1].from;
						const urlNode = node.node.getChild('URL');
						const src = urlNode ? state.sliceDoc(urlNode.from, urlNode.to) : '';
						const alt = state.sliceDoc(altFrom, altTo);
						if (!cursorTouchesRange(state, node.from, node.to)) {
							pushReplace(node.from, node.to, Decoration.replace({ widget: new ImageWidget(src, alt) }));
						}
						return false;
					}
					case 'Table': {
						if (!cursorTouchesRange(state, node.from, node.to) && isLineAligned(state, node.from, node.to)) {
							// Rendered as a rich table by blockDecorationsField. Block
							// decorations may not be supplied from a view plugin, so emit
							// nothing here and let the state field replace this range.
							return false;
						}
						decorations.push(Decoration.mark({ class: 'mlp-table-raw' }).range(node.from, node.to));
						return;
					}
				}
			},
		});
	}

	for (const [lineFrom, cls] of seenLine) {
		decorations.push(Decoration.line({ class: cls }).range(lineFrom));
	}

	return Decoration.set(decorations, true);
}

export const livePreviewPlugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = buildDecorations(view);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.viewportChanged || update.selectionSet) {
				this.decorations = buildDecorations(update.view);
			}
		}
	},
	{ decorations: (v) => v.decorations },
);

export function createLinkClickHandler(onOpen: (href: string) => void) {
	return EditorView.domEventHandlers({
		mousedown(event) {
			if (!(event.ctrlKey || event.metaKey)) return false;
			const target = event.target as HTMLElement | null;
			const linkEl = target?.closest('.mlp-link') as HTMLElement | null;
			const href = linkEl?.getAttribute('data-href');
			if (href) {
				event.preventDefault();
				onOpen(href);
				return true;
			}
			return false;
		},
	});
}
