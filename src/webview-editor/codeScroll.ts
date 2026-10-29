import { StateField, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { isDiagramLang } from './diagramLang';
import { detectFrontmatter } from './frontmatterWidget';
import { t } from '../shared/i18n';

interface CodeRange { from: number; to: number; contentFrom: number; contentTo: number }

class CodeScrollbar extends WidgetType {
	constructor(readonly from: number) { super(); }
	eq(other: CodeScrollbar): boolean { return other.from === this.from; }
	toDOM(view: EditorView): HTMLElement {
		const bar = document.createElement('div');
		bar.className = 'mlp-code-scrollbar';
		bar.dataset.codeFrom = String(this.from);
		bar.tabIndex = 0;
		bar.setAttribute('aria-label', t('code.scroll'));
		bar.appendChild(document.createElement('div')).className = 'mlp-code-scrollbar-width';
		bar.addEventListener('scroll', () => view.plugin(codeScrollPlugin)?.scroll(this.from, bar.scrollLeft));
		return bar;
	}
	ignoreEvent(): boolean { return true; }
}

const codeScrollField = StateField.define<{ ranges: CodeRange[]; decorations: DecorationSet }>({
	create: buildScrollbars,
	update(value, tr) {
		return tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? buildScrollbars(tr.state) : value;
	},
	provide: field => EditorView.decorations.from(field, value => value.decorations),
});

function buildScrollbars(state: import('@codemirror/state').EditorState) {
	const ranges: CodeRange[] = [];
	const decorations: Range<Decoration>[] = [];
	const fm = detectFrontmatter(state);
	syntaxTree(state).iterate({ enter(node) {
		if (fm && node.from >= fm.from && node.to <= fm.to) return false;
		if (node.name !== 'FencedCode') return;
		const info = node.node.getChild('CodeInfo');
		if (isDiagramLang(info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : '')) return false;
		const from = state.doc.lineAt(node.from).from;
		const text = node.node.getChild('CodeText');
		ranges.push({ from, to: node.to, contentFrom: text?.from ?? node.to, contentTo: text?.to ?? node.to });
		decorations.push(Decoration.widget({ widget: new CodeScrollbar(from), block: true, side: 1 }).range(node.to));
		return false;
	} });
	return { ranges, decorations: Decoration.set(decorations, true) };
}

interface ScrollGroup {
	from: number;
	rows: HTMLElement[];
	bar?: HTMLElement;
	width: number;
	viewport: number;
	background?: string;
}

const codeScrollPlugin = ViewPlugin.fromClass(class {
	positions = new Map<number, number>();
	groups = new Map<number, ScrollGroup>();
	rowListeners = new Map<HTMLElement, { scroll: () => void; wheel: (event: WheelEvent) => void }>();
	rowOwners = new Map<HTMLElement, number>();
	textWidths = new Map<number, { text: string; font: string; tabSize: number; width: number }>();
	canvas = document.createElement('canvas').getContext('2d');
	themeObserver = new MutationObserver(() => this.measure());
	constructor(readonly view: EditorView) {
		// Color-only CSS changes do not cause a geometry update. Refresh the
		// copied scrollbar background when user CSS or VS Code's palette changes.
		this.themeObserver.observe(document.head, { childList: true, characterData: true, subtree: true });
		for (const element of [document.documentElement, document.body]) {
			this.themeObserver.observe(element, { attributes: true, attributeFilter: ['class', 'style'] });
		}
		this.measure();
	}
	update(update: ViewUpdate) {
		if (update.docChanged) {
			this.positions = new Map([...this.positions].map(([from, left]) => [update.changes.mapPos(from, -1), left]));
			this.textWidths.clear();
		}
		if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet ||
			update.startState.field(codeScrollField) !== update.state.field(codeScrollField)) this.measure();
	}
	measure() {
		this.view.requestMeasure({ key: this,
			read: view => {
				const ranges = view.state.field(codeScrollField).ranges;
				const groups = new Map<number, ScrollGroup>();
				const bars = new Map<number, HTMLElement>();
				const backgrounds = new Map<number, string>();
				for (const bar of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.mlp-code-scrollbar'))) {
					const from = Number(bar.dataset.codeFrom);
					bars.set(from, bar);
				}
				for (const header of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.mlp-code-toolbar-line'))) {
					backgrounds.set(view.posAtDOM(header), getComputedStyle(header).backgroundColor);
				}
				for (const row of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.mlp-line-code:not(.mlp-code-toolbar-line)'))) {
					const pos = view.posAtDOM(row);
					const block = ranges.find(range => range.from <= pos && range.to >= pos);
					if (!block) continue;
					let group = groups.get(block.from);
					if (!group) {
						group = { from: block.from, bar: bars.get(block.from), rows: [], width: 0, viewport: row.clientWidth };
						groups.set(block.from, group);
					}
					const range = document.createRange();
					range.selectNodeContents(row);
					const style = getComputedStyle(row);
					const width = range.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
					group.rows.push(row);
					group.width = Math.max(group.width, Math.ceil(width));
				}
				// Measure the full source too: the longest line may be outside the
				// rendered viewport, including when only the footer is on screen.
				for (const [from, bar] of bars) {
					if (!groups.has(from)) groups.set(from, { from, bar, rows: [], width: 0, viewport: bar.clientWidth });
				}
				for (const group of groups.values()) {
					group.viewport = group.bar?.clientWidth || group.viewport;
					group.background = backgrounds.get(group.from) ?? (group.rows[0] && getComputedStyle(group.rows[0]).backgroundColor);
					const block = ranges.find(range => range.from === group.from);
					if (!block) continue;
					const sample = group.rows[0] ?? view.contentDOM.querySelector<HTMLElement>('.mlp-line-code:not(.mlp-code-toolbar-line)');
					if (!sample || !this.canvas) continue;
					const style = getComputedStyle(sample);
					const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
					const tabSize = parseInt(style.tabSize, 10) || 4;
					const text = view.state.sliceDoc(block.contentFrom, block.contentTo);
					let measured = this.textWidths.get(group.from);
					if (!measured || measured.text !== text || measured.font !== font || measured.tabSize !== tabSize) {
						this.canvas.font = font;
						let width = 0;
						for (const line of text.split('\n')) {
							let column = 0;
							const expanded = line.replace(/\t|[^\t]+/g, part => {
								if (part !== '\t') { column += part.length; return part; }
								const count = tabSize - column % tabSize;
								column += count;
								return ' '.repeat(count);
							});
							width = Math.max(width, this.canvas.measureText(expanded).width);
						}
						measured = { text, font, tabSize, width };
						this.textWidths.set(group.from, measured);
					}
					group.width = Math.max(group.viewport, group.width, Math.ceil(measured.width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)));
				}
				return groups;
			},
			write: groups => {
				this.groups = groups;
				const liveRows = new Set<HTMLElement>();
				for (const group of groups.values()) {
					const overflow = group.width > group.viewport + 1;
					if (group.bar) {
						group.bar.dataset.overflow = String(overflow);
						if (group.background) group.bar.style.backgroundColor = group.background;
						(group.bar.firstElementChild as HTMLElement).style.width = `${group.width}px`;
					}
					for (const row of group.rows) {
						liveRows.add(row);
						this.rowOwners.set(row, group.from);
						row.classList.toggle('mlp-code-scrollable-row', overflow);
						row.style.setProperty('--mlp-code-scroll-width', `${group.width}px`);
						if (!this.rowListeners.has(row)) {
							const scroll = () => {
								const from = this.rowOwners.get(row);
								if (from !== undefined && row.scrollLeft !== (this.positions.get(from) ?? 0)) this.scroll(from, row.scrollLeft);
							};
							const wheel = (event: WheelEvent) => {
								const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
								const from = this.rowOwners.get(row);
								if (from !== undefined && delta && this.scroll(from, (this.positions.get(from) ?? 0) + delta)) event.preventDefault();
							};
							row.addEventListener('scroll', scroll);
							row.addEventListener('wheel', wheel, { passive: false });
							this.rowListeners.set(row, { scroll, wheel });
						}
					}
					this.scroll(group.from, overflow ? this.positions.get(group.from) ?? 0 : 0);
				}
				for (const [row, handlers] of this.rowListeners) {
					if (!liveRows.has(row)) {
						row.removeEventListener('scroll', handlers.scroll);
						row.removeEventListener('wheel', handlers.wheel);
						this.rowListeners.delete(row);
						this.rowOwners.delete(row);
					}
				}
			},
		});
	}
	scroll(from: number, requested: number): boolean {
		const group = this.groups.get(from);
		if (!group) return false;
		const left = Math.max(0, Math.min(requested, group.width - group.viewport));
		const moved = left !== (this.positions.get(from) ?? 0);
		this.positions.set(from, left);
		for (const row of group.rows) row.scrollLeft = left;
		if (group.bar) group.bar.scrollLeft = left;
		return moved;
	}
	destroy() {
		this.themeObserver.disconnect();
		for (const [row, handlers] of this.rowListeners) {
			row.removeEventListener('scroll', handlers.scroll);
			row.removeEventListener('wheel', handlers.wheel);
		}
	}
});

export const codeScrollExtension = [codeScrollField, codeScrollPlugin];
