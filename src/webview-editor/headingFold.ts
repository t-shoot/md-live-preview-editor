import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { codeFolding, ensureSyntaxTree, foldEffect, foldedRanges, foldKeymap, foldService, syntaxTree, unfoldEffect } from '@codemirror/language';
import { detectFrontmatter } from './frontmatterWidget';
import { t } from '../shared/i18n';
import { setControlIcon } from './controlIcons';

interface HeadingSection {
	headingFrom: number;
	from: number;
	to: number;
	level: number;
	title: string;
}

/** Only parsed, top-level headings count; # inside code or YAML is ordinary text. */
export function headingSections(state: EditorState): HeadingSection[] {
	const sections: HeadingSection[] = [];
	const stack: HeadingSection[] = [];
	const fm = detectFrontmatter(state);
	const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
	// An unfinished parse cannot tell where the last section ends. Wait for
	// its boundary rather than hiding a later, as-yet-unparsed sibling heading.
	const documentEnd = tree.length === state.doc.length ? state.doc.length : -1;
	tree.iterate({
		enter(node) {
			if (node.name === 'Document') return;
			const match = /^ATXHeading([1-6])$/.exec(node.name);
			if (match && (!fm || node.from > fm.to)) {
				const line = state.doc.lineAt(node.from);
				const level = Number(match[1]);
				while (stack.length && stack[stack.length - 1].level >= level) {
					stack.pop()!.to = line.from - 1;
				}
				const section = {
					headingFrom: line.from, from: line.to, to: documentEnd, level,
					title: line.text.replace(/^\s*#{1,6}\s+/, '').replace(/\s+#+\s*$/, ''),
				};
				sections.push(section);
				stack.push(section);
			}
			return false;
		},
	});
	return sections.filter(section => section.to > section.from && state.sliceDoc(section.from, section.to).trim());
}

const sectionsField = StateField.define<HeadingSection[]>({
	create: headingSections,
	update(value, tr) {
		return tr.docChanged || syntaxTree(tr.startState) !== syntaxTree(tr.state) ? headingSections(tr.state) : value;
	},
});

function foldedSection(state: EditorState, from: number): { from: number; to: number } | undefined {
	let result: { from: number; to: number } | undefined;
	foldedRanges(state).between(from, from, (start, to) => {
		if (start === from) result = { from: start, to };
	});
	return result;
}

class HeadingFoldToggle extends WidgetType {
	constructor(readonly headingFrom: number, readonly collapsed: boolean, readonly title: string) { super(); }
	eq(other: HeadingFoldToggle): boolean {
		return this.headingFrom === other.headingFrom && this.collapsed === other.collapsed && this.title === other.title;
	}
	toDOM(view: EditorView): HTMLElement {
		const host = document.createElement('span');
		host.className = 'mlp-heading-fold-host';
		host.contentEditable = 'false';
		const button = host.appendChild(document.createElement('button'));
		button.type = 'button';
		button.className = 'mlp-heading-fold-toggle';
		setControlIcon(button, 'headingFold');
		button.querySelector('svg')!.classList.add('mlp-heading-fold-chevron');
		button.title = t(this.collapsed ? 'heading.unfold' : 'heading.fold', this.title);
		button.setAttribute('aria-label', button.title);
		button.setAttribute('aria-expanded', String(!this.collapsed));
		button.addEventListener('mousedown', event => event.preventDefault());
		button.addEventListener('click', event => {
			event.preventDefault();
			// A table cell commits on focusout. Commit before removing its DOM,
			// outside the folding transaction, and then read the updated range.
			const active = view.root.activeElement;
			if (active instanceof HTMLElement && active.classList.contains('mlp-table-cell-editing')) active.blur();
			const section = view.state.field(sectionsField).find(section => section.headingFrom === this.headingFrom);
			if (!section) return;
			const folded = foldedSection(view.state, section.from);
			// Move a cursor out of the hidden body before folding. Otherwise a later
			// keystroke could edit text the reader cannot see.
			const selectionInside = view.state.selection.ranges.some(range => range.to > section.from && range.from < section.to);
			view.dispatch({
				effects: folded ? unfoldEffect.of(folded) : foldEffect.of({ from: section.from, to: section.to }),
				...(!folded && selectionInside ? { selection: { anchor: section.from } } : {}),
			});
		});
		return host;
	}
	ignoreEvent(): boolean { return true; }
}

const headingControls = ViewPlugin.fromClass(class {
	decorations: DecorationSet;
	constructor(view: EditorView) { this.decorations = this.build(view); }
	update(update: ViewUpdate) {
		if (update.docChanged || update.viewportChanged || update.startState.field(sectionsField) !== update.state.field(sectionsField) ||
			foldedRanges(update.startState) !== foldedRanges(update.state)) this.decorations = this.build(update.view);
	}
	build(view: EditorView) {
		const decorations: Range<Decoration>[] = [];
		const folds = foldedRanges(view.state);
		for (const section of view.state.field(sectionsField)) {
			if (!view.visibleRanges.some(range => section.headingFrom >= range.from && section.headingFrom <= range.to)) continue;
			let hidden = false;
			folds.between(section.headingFrom, section.headingFrom, (from, to) => { if (from < section.headingFrom && to > section.headingFrom) hidden = true; });
			if (hidden) continue;
			decorations.push(Decoration.widget({
				widget: new HeadingFoldToggle(section.headingFrom, !!foldedSection(view.state, section.from), section.title), side: -1,
			}).range(section.headingFrom));
		}
		return Decoration.set(decorations, true);
	}
}, { decorations: plugin => plugin.decorations });

export const headingFoldExtension: Extension = [
	codeFolding({
		placeholderDOM(_view, onclick) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'mlp-heading-fold-placeholder';
			button.textContent = '…';
			button.title = t('heading.unfold', '');
			button.setAttribute('aria-label', button.title);
			button.addEventListener('mousedown', event => event.preventDefault());
			button.addEventListener('click', onclick);
			return button;
		},
	}),
	sectionsField,
	foldService.of((state, lineStart) => {
		const section = state.field(sectionsField).find(section => section.headingFrom === lineStart);
		return section ? { from: section.from, to: section.to } : null;
	}),
	headingControls,
	keymap.of(foldKeymap),
];
