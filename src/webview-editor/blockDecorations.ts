import { StateField, type EditorState, type Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { parse as parseYaml } from 'yaml';
import { MermaidWidget } from './mermaidWidget';
import { DrawioWidget } from './drawioWidget';
import { isDiagramLang } from './diagramLang';
import { buildTableWidget, isLineAligned, alignedBlockRange } from './livePreviewPlugin';
import { isBlockRevealed, blockRevealChanged } from './cmUtils';
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
	const fmRevealed = fm ? isBlockRevealed(fm.from) : false;
	if (fm && !fmRevealed) {
		let widget: WidgetType;
		try {
			const data = parseYaml(fm.yamlText) ?? {};
			const entries = Object.entries(data);
			widget = entries.length === 0 ? new FrontmatterEmptyWidget() : new FrontmatterWidget(entries, fm.from);
		} catch (err) {
			widget = new FrontmatterErrorWidget(err instanceof Error ? err.message : String(err), fm.from);
		}
		decorations.push(Decoration.replace({ widget, block: true }).range(fm.from, fm.to));
	}

	tree.iterate({
		enter: (node) => {
			if (fm && node.from >= fm.from && node.to <= fm.to) return false;
			if (node.name === 'FencedCode') {
				const infoNode = node.node.getChild('CodeInfo');
				const lang = infoNode ? state.sliceDoc(infoNode.from, infoNode.to).trim().toLowerCase() : '';
				const diagram = isDiagramLang(lang);
				if (!diagram) return;
				const blockFrom = state.doc.lineAt(node.from).from;
				if (isBlockRevealed(blockFrom)) return;
				if (!isLineAligned(state, node.from, node.to)) return;
				const textNode = node.node.getChild('CodeText');
				const code = textNode ? state.sliceDoc(textNode.from, textNode.to) : '';
				if (!code.trim()) return;
				const widget = diagram === 'mermaid' ? new MermaidWidget(code, blockFrom) : new DrawioWidget(code, blockFrom);
				decorations.push(Decoration.replace({ widget, block: true }).range(node.from, node.to));
				return false;
			}
			if (node.name === 'Table') {
				const tableFrom = state.doc.lineAt(node.from).from;
				if (isBlockRevealed(tableFrom)) return;
				const range = alignedBlockRange(state, node.from, node.to);
				if (!range) return;
				decorations.push(
					Decoration.replace({ widget: buildTableWidget(state, node), block: true }).range(range.from, range.to),
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
		// Rebuild on edits, when a "図" block's own button flips `isBlockRevealed`
		// (see cmUtils.ts — plain module state, invisible to this field unless a
		// transaction says so), and when background parsing advances the syntax
		// tree — the last one matters because blocks near the end of a long
		// document aren't in the tree yet on the first render. Deliberately *not*
		// on `tr.selection`: a "図" block's rendered-vs-raw state no longer
		// depends on the caret at all.
		if (
			tr.docChanged ||
			tr.effects.some((e) => e.is(blockRevealChanged)) ||
			syntaxTree(tr.startState) !== syntaxTree(tr.state)
		) {
			return buildBlockDecorations(tr.state);
		}
		return value;
	},
	provide: (field) => EditorView.decorations.from(field),
});
