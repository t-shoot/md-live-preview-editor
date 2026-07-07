import type { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';

export interface FrontmatterRange {
	from: number;
	to: number;
	yamlText: string;
}

/**
 * Detects a YAML frontmatter block: the document's first line must be exactly
 * `---`, followed later by a line that is also exactly `---`. Unlike every other
 * block construct in this app, frontmatter has no `@lezer/markdown` node of its
 * own, so this is a plain line scan over `state.doc`, not a syntax-tree match.
 */
export function detectFrontmatter(state: EditorState): FrontmatterRange | null {
	const { doc } = state;
	if (doc.lines < 2 || doc.line(1).text !== '---') return null;

	for (let n = 2; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (line.text === '---') {
			const yamlText = n > 2 ? doc.sliceString(doc.line(2).from, doc.line(n - 1).to) : '';
			return { from: doc.line(1).from, to: line.to, yamlText };
		}
	}
	return null;
}

function isScalar(value: unknown): boolean {
	return value === null || (typeof value !== 'object' && typeof value !== 'function');
}

/** Human-readable text for one frontmatter value (design.md §6). */
function formatValue(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (isScalar(value)) return String(value);
	if (Array.isArray(value) && value.every(isScalar)) {
		return value.map((v) => (v === null || v === undefined ? '' : String(v))).join(', ');
	}
	return JSON.stringify(value, null, 2);
}

function jumpToRange(view: EditorView, el: HTMLElement): void {
	const pos = view.posAtDOM(el);
	view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
	view.focus();
}

/** Renders a parsed frontmatter (1+ entries) as a key/value table. */
export class FrontmatterWidget extends WidgetType {
	constructor(private readonly entries: Array<[string, unknown]>) {
		super();
	}

	eq(other: FrontmatterWidget): boolean {
		return JSON.stringify(other.entries) === JSON.stringify(this.entries);
	}

	toDOM(view: EditorView): HTMLElement {
		const table = document.createElement('table');
		table.className = 'mlp-frontmatter';
		const tbody = document.createElement('tbody');
		for (const [key, value] of this.entries) {
			const tr = document.createElement('tr');
			const th = document.createElement('th');
			th.textContent = key;
			const td = document.createElement('td');
			const formatted = formatValue(value);
			if (formatted.includes('\n')) {
				const pre = document.createElement('pre');
				pre.textContent = formatted;
				td.appendChild(pre);
			} else {
				td.textContent = formatted;
			}
			tr.append(th, td);
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		table.addEventListener('mousedown', (event) => {
			event.preventDefault();
			jumpToRange(view, table);
		});
		return table;
	}

	ignoreEvent(): boolean {
		return false;
	}
}

/**
 * Renders a parsed-but-empty frontmatter (0 entries) as nothing. Implements
 * `estimatedHeight` like `HiddenMarkerWidget` in livePreviewPlugin.ts, so
 * CodeMirror's line-height sampler can't mistake it for a plain text line.
 */
export class FrontmatterEmptyWidget extends WidgetType {
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

/** Renders a YAML parse failure in place of the table. */
export class FrontmatterErrorWidget extends WidgetType {
	constructor(private readonly message: string) {
		super();
	}

	eq(other: FrontmatterErrorWidget): boolean {
		return other.message === this.message;
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('div');
		container.className = 'mlp-frontmatter-error';
		container.setAttribute('role', 'alert');
		const strong = document.createElement('strong');
		strong.textContent = 'フロントマターの解析に失敗しました';
		const pre = document.createElement('pre');
		pre.textContent = this.message;
		container.append(strong, pre);
		container.addEventListener('mousedown', (event) => {
			event.preventDefault();
			jumpToRange(view, container);
		});
		return container;
	}

	ignoreEvent(): boolean {
		return false;
	}
}
