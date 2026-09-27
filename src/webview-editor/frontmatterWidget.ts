import type { EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { wrapBlockWidget } from './blockWidgetWrap';
import { withCodeModeButton, createRenderModeButton } from './codeModeButton';
import { setBlockRevealed, blockRevealChanged } from './cmUtils';
import { t } from '../shared/i18n';

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

/** Renders a parsed frontmatter (1+ entries) as a key/value table. */
export class FrontmatterWidget extends WidgetType {
	constructor(
		private readonly entries: Array<[string, unknown]>,
		private readonly blockFrom: number,
	) {
		super();
	}

	eq(other: FrontmatterWidget): boolean {
		return other.blockFrom === this.blockFrom && JSON.stringify(other.entries) === JSON.stringify(this.entries);
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
		// The `</>` button is the only way in — a "図" block, so nothing about a
		// plain click on it should move the caret or change what's shown (see
		// `isBlockRevealed` in cmUtils.ts). `ignoreEvent` below leaves such a click
		// with nothing to do, the same as clicking a Mermaid diagram.
		return wrapBlockWidget(
			withCodeModeButton(view, table, {
				anchor: table,
				onReveal: () => setBlockRevealed(this.blockFrom, true),
			}),
		);
	}

	ignoreEvent(): boolean {
		return true;
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
	constructor(
		private readonly message: string,
		private readonly blockFrom: number,
	) {
		super();
	}

	eq(other: FrontmatterErrorWidget): boolean {
		return other.blockFrom === this.blockFrom && other.message === this.message;
	}

	toDOM(view: EditorView): HTMLElement {
		const container = document.createElement('div');
		container.className = 'mlp-frontmatter-error';
		container.setAttribute('role', 'alert');
		const strong = document.createElement('strong');
		strong.textContent = t('frontmatter.parseFailed');
		const pre = document.createElement('pre');
		pre.textContent = this.message;
		container.append(strong, pre);
		// A parse error is exactly when the source needs reaching, so the button
		// matters most here — still the only way in, same as the table above.
		return wrapBlockWidget(
			withCodeModeButton(view, container, {
				anchor: container,
				onReveal: () => setBlockRevealed(this.blockFrom, true),
			}),
		);
	}

	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * Where the caret should land once frontmatter switches back to its rendered
 * view, re-derived from the *current* document rather than the position
 * remembered when `FrontmatterRenderButtonWidget` was built — the YAML can
 * have been edited (and so shrunk or grown) in the meantime.
 *
 * When frontmatter runs all the way to the end of the document, there is no
 * line after it to land on; `insert` then adds one to land on instead, the
 * same fallback `TableRenderButtonWidget` uses for a table in the same spot.
 */
function frontmatterRenderTarget(
	state: EditorState,
	blockFrom: number,
): { anchor: number; insert?: string } {
	const doc = state.doc;
	const current = detectFrontmatter(state);
	const to = current?.to ?? blockFrom;
	const lastLine = doc.lineAt(Math.min(to, doc.length));
	if (lastLine.number < doc.lines) {
		return { anchor: doc.line(lastLine.number + 1).from };
	}
	return { anchor: doc.length + 1, insert: '\n' };
}

/**
 * Floats the "back to rendered view" button over frontmatter's raw YAML,
 * anchored to its first line — the same placement `TableRenderButtonWidget`
 * and `CopyCodeWidget` use for their own first line.
 */
export class FrontmatterRenderButtonWidget extends WidgetType {
	constructor(private readonly blockFrom: number) {
		super();
	}
	eq(other: FrontmatterRenderButtonWidget): boolean {
		return other.blockFrom === this.blockFrom;
	}
	toDOM(view: EditorView): HTMLElement {
		const host = document.createElement('span');
		host.className = 'mlp-render-mode-host';
		host.appendChild(
			createRenderModeButton(() => {
				setBlockRevealed(this.blockFrom, false);
				const { anchor, insert } = frontmatterRenderTarget(view.state, this.blockFrom);
				view.dispatch(
					insert === undefined
						? { selection: { anchor }, effects: blockRevealChanged.of(null), scrollIntoView: true }
						: {
								changes: { from: view.state.doc.length, insert },
								selection: { anchor },
								effects: blockRevealChanged.of(null),
								scrollIntoView: true,
							},
				);
			}),
		);
		return host;
	}
	get estimatedHeight(): number {
		return 0;
	}
	ignoreEvent(): boolean {
		return true;
	}
}
