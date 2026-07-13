import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { parse as parseYaml } from 'yaml';
import { MermaidWidget } from './mermaidWidget';
import { buildTableWidget, isLineAligned } from './livePreviewPlugin';
import { cursorTouchesRange } from './cmUtils';
import { detectFrontmatter, FrontmatterWidget, FrontmatterEmptyWidget, FrontmatterErrorWidget } from './frontmatterWidget';

/**
 * CodeMirror 6 forbids block decorations (block widgets / block-replacing
 * ranges) from being supplied by a ViewPlugin — doing so throws
 * "Block decorations may not be specified via plugins" while the EditorView is
 * being constructed, which blanks the whole editor. The rendered mermaid
 * diagrams and tables are block-level, so they are provided here through a
 * StateField instead, which is the sanctioned source for block decorations.
 */
function buildBlockDecorations(state: EditorState): DecorationSet {
	const decorations: Range<Decoration>[] = [];
	const tree = syntaxTree(state);

	// Frontmatter has no dedicated `@lezer/markdown` node, so it's detected by a
	// plain line scan (see frontmatterWidget.ts) rather than via tree.iterate()
	// below. Computed once up front so the tree walk can both render it and skip
	// any node the parser mistakenly finds *entirely inside* it (e.g. a YAML line
	// that happens to look like a table row) — without that guard, a
	// Table/FencedCode decoration overlapping this range would violate the
	// sorted, non-overlapping range requirement `Decoration.set` enforces.
	// The skip below only fires for nodes *fully contained* in [fm.from, fm.to),
	// never for an ancestor that merely spans across the block (fm.from is
	// always 0, so the tree's own root node always satisfies a naive "any
	// overlap" test — that used to make `tree.iterate` skip its own root and
	// silently produce zero decorations for the *entire* document whenever
	// frontmatter was present, not just inside the frontmatter block).
	const fm = detectFrontmatter(state);
	if (fm && !cursorTouchesRange(state, fm.from, fm.to)) {
		let widget: WidgetType;
		try {
			const data = parseYaml(fm.yamlText) ?? {};
			const entries = Object.entries(data);
			widget = entries.length === 0 ? new FrontmatterEmptyWidget() : new FrontmatterWidget(entries);
		} catch (err) {
			widget = new FrontmatterErrorWidget(err instanceof Error ? err.message : String(err));
		}
		decorations.push(Decoration.replace({ widget, block: true }).range(fm.from, fm.to));
	}

	tree.iterate({
		enter: (node) => {
			if (fm && node.from >= fm.from && node.to <= fm.to) return false;
			if (node.name === 'FencedCode') {
				const infoNode = node.node.getChild('CodeInfo');
				const lang = infoNode ? state.sliceDoc(infoNode.from, infoNode.to).trim().toLowerCase() : '';
				if (lang !== 'mermaid') return;
				if (cursorTouchesRange(state, node.from, node.to)) return;
				if (!isLineAligned(state, node.from, node.to)) return;
				const textNode = node.node.getChild('CodeText');
				const code = textNode ? state.sliceDoc(textNode.from, textNode.to) : '';
				if (!code.trim()) return;
				decorations.push(
					Decoration.replace({ widget: new MermaidWidget(code), block: true }).range(node.from, node.to),
				);
				return false;
			}
			if (node.name === 'Table') {
				if (cursorTouchesRange(state, node.from, node.to)) return;
				if (!isLineAligned(state, node.from, node.to)) return;
				decorations.push(
					Decoration.replace({ widget: buildTableWidget(state, node), block: true }).range(node.from, node.to),
				);
				return false;
			}
		},
	});

	return Decoration.set(decorations, true);
}

export const blockDecorationsField = StateField.define<DecorationSet>({
	create(state) {
		return buildBlockDecorations(state);
	},
	update(value, tr) {
		// Rebuild on edits, on selection moves (a cursor entering a block reveals
		// its raw source), and when background parsing advances the syntax tree —
		// the latter matters because blocks near the end of a long document aren't
		// in the tree yet on the first render.
		if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
			return buildBlockDecorations(tr.state);
		}
		return value;
	},
	provide: (field) => EditorView.decorations.from(field),
});
