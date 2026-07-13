/**
 * Adapts CSS written for VS Code's built-in Markdown preview (the
 * `markdown.styles` format, which targets standard HTML element selectors such
 * as `h1`, `blockquote`, `pre code`, `table`, `body.vscode-dark …`) onto the
 * live-preview's CodeMirror DOM.
 *
 * The live preview is a CodeMirror editor, not rendered HTML, so block elements
 * are represented as `.cm-line` variants (headings, code, quotes, lists,
 * paragraphs) while inline elements (`strong`, `em`, `code`, `a`, `del`) and
 * `table`/`th`/`td`/`img` are emitted with their real tags and therefore need no
 * mapping. This transformer rewrites the block-element selectors so an
 * unmodified VS Code Markdown theme can be dropped in and mostly "just work".
 *
 * Only selectors are rewritten; declaration blocks pass through untouched.
 */

const ELEMENT_MAP: Record<string, string> = {
	// Block elements → their `.cm-line` representation.
	h1: '.cm-line.mlp-line-h1',
	h2: '.cm-line.mlp-line-h2',
	h3: '.cm-line.mlp-line-h3',
	h4: '.cm-line.mlp-line-h4',
	h5: '.cm-line.mlp-line-h5',
	h6: '.cm-line.mlp-line-h6',
	blockquote: '.cm-line.mlp-line-quote',
	pre: '.cm-line.mlp-line-code',
	p: '.cm-line.mlp-line-paragraph',
	li: '.cm-line.mlp-line-list',
	ul: '.cm-line.mlp-line-list',
	ol: '.cm-line.mlp-line-list',
	hr: '.mlp-hr',
	// Inline code (the `pre code` sequence is handled before this) → our span.
	code: '.mlp-inline-code',
	// The reading column stands in for `body`. Match the base theme's specificity
	// (`.cm-editor .cm-content`) so a later-injected user rule can override it.
	body: '.cm-editor .cm-content',
};

// Tags we render for real and therefore leave alone: a, strong, em, del,
// img, table, thead, tbody, tr, th, td, span, div.

function transformCompound(token: string): string {
	const match = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(token);
	if (!match) return token; // starts with . # : [ ( etc. — a class/pseudo/attr
	const name = match[1].toLowerCase();
	const rest = token.slice(match[1].length);
	if (name === 'body') {
		// Keep theme-gated body selectors (`body.vscode-dark`, `body.vscode-light`,
		// `body.vscode-high-contrast`) as-is — the webview <body> carries those
		// classes, so they keep working and correctly gate on the active theme.
		if (/^\.(vscode-|high-contrast)/i.test(rest)) return token;
		return ELEMENT_MAP.body + rest;
	}
	if (name in ELEMENT_MAP) return ELEMENT_MAP[name] + rest;
	return token;
}

function transformSelector(selector: string): string {
	let s = selector.trim();
	// A standalone `body` (optionally theme-gated) sets page-level properties —
	// font, colour, background, max-width — which in the live preview belong on the
	// reading column. Redirect it there, preserving any `body.vscode-*` gate so the
	// column's dark-theme background/colour still switches correctly.
	const standaloneBody = /^body((?:\.[\w-]+)*)$/i.exec(s);
	if (standaloneBody) {
		const themeClasses = standaloneBody[1];
		return themeClasses ? `body${themeClasses} .cm-editor .cm-content` : '.cm-editor .cm-content';
	}
	// Sequences first: `pre code` targets the code text *inside* the block. In HTML
	// that <code> is a child of <pre> and typically resets its own background to
	// transparent so the <pre> background shows through. Our block code has no
	// nested element, so map it to the code line's children (`> *`) — that keeps
	// `pre`'s background on the line itself instead of letting the child's
	// `background: transparent` erase it.
	s = s.replace(/\bpre\s*>?\s*code\b/gi, '.cm-line.mlp-line-code > *');
	// Task-list checkboxes are rendered as a styled span, not an <input>.
	s = s.replace(/input\s*\[\s*type\s*=\s*['"]?checkbox['"]?\s*\]/gi, '.mlp-checkbox');
	// Split into simple selectors on combinators (whitespace, > + ~), keeping the
	// separators, and map the leading type selector of each.
	return s
		.split(/(\s*[>+~]\s*|\s+)/)
		.map((part) => (/^\s*[>+~]?\s*$/.test(part) ? part : transformCompound(part)))
		.join('');
}

function transformSelectorList(selectorList: string): string {
	return selectorList
		.split(',')
		.map((sel) => {
			const leading = sel.match(/^\s*/)?.[0] ?? '';
			const trailing = sel.match(/\s*$/)?.[0] ?? '';
			return leading + transformSelector(sel.trim()) + trailing;
		})
		.join(',');
}

// ── `pre code` text-color fallback ──────────────────────────────────────────
// `pre code` maps to `.cm-line.mlp-line-code > *` (a direct-child selector) so
// its `background: transparent` etc. don't erase the `pre`-derived background
// on the line itself (see below). But CodeMirror only wraps code text in a
// child element where a decoration applies (e.g. a syntax-highlighting token);
// plain, undecorated text — the common case for a language outside the
// highlighter's curated set — is a bare text node directly inside `.cm-line`,
// which only inherits color from the reading column (`body`), never from a
// `> *` rule. Left alone, that text silently renders in whatever color the
// theme picked for its (unrelated) page background context — e.g. a theme
// that pairs a light page with a dark code box, via a dark `pre` background +
// light `pre code` text color, renders that text almost invisibly dark-on-dark.
// The fix: also copy just the inheritable text properties (color, font, …)
// from `pre code` onto the line itself, so bare text inherits them directly.
// Box properties (background, border, padding, …) are deliberately excluded so
// they still only apply via `> *`, never overwriting the line's own box.
const PRE_CODE_SELECTOR_RE = /^\.cm-line\.mlp-line-code\s*>\s*\*$/;
const INHERITABLE_TEXT_PROPS = new Set([
	'color',
	'font',
	'font-family',
	'font-size',
	'font-style',
	'font-weight',
	'font-variant',
	'line-height',
	'letter-spacing',
	'word-spacing',
	'text-decoration',
	'text-decoration-line',
	'text-decoration-color',
	'text-decoration-style',
	'text-shadow',
	'text-transform',
]);

function isPreCodeSelectorList(selectorList: string): boolean {
	const sels = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
	return sels.length > 0 && sels.every((s) => PRE_CODE_SELECTOR_RE.test(s));
}

function splitPreCodeRule(selectorList: string, body: string): string {
	const inheritable: string[] = [];
	for (const item of parseDeclarations(body)) {
		if ('raw' in item) continue;
		if (INHERITABLE_TEXT_PROPS.has(item.prop.toLowerCase())) {
			inheritable.push(`${item.prop}: ${item.value}`);
		}
	}
	if (inheritable.length === 0) {
		return `${selectorList}{${body}}`;
	}
	const baseSels = selectorList
		.split(',')
		.map((s) => s.trim().replace(/\s*>\s*\*$/, ''))
		.filter(Boolean);
	return `${baseSels.join(', ')} {\n\t${inheritable.join(';\n\t')};\n}\n${selectorList}{${body}}`;
}

// ── Multi-line block distribution ───────────────────────────────────────────
// `pre`, `blockquote`, `p` and `li`/`ul`/`ol` all map to *per-line* selectors
// (`.cm-line.mlp-line-*`) because the live preview has no single element
// wrapping a block that spans multiple source lines (a fenced code block, a
// blockquote, or a hard-wrapped paragraph/list item). Properties that describe
// the block's outline — borders, corner radii, vertical padding/margin — must
// therefore be spread across lines: the top edge onto the first line, the
// bottom edge onto the last line, side edges onto every line. Applied naively
// to every line instead, a rule like `blockquote { margin-bottom: 1rem;
// border-radius: 6px }` draws a separate rounded box with a gap after *each*
// line, splitting what should be one continuous block apart.
const MULTILINE_BLOCK_CLASSES = ['mlp-line-code', 'mlp-line-quote', 'mlp-line-paragraph', 'mlp-line-list'];

// A selector that targets one of the block line classes itself (not e.g.
// `pre code`, which becomes `.cm-line.mlp-line-code > *` and keeps its
// trailing `> *`, so the `$` anchor excludes it).
const BLOCK_SELECTOR_RE = new RegExp(`\\.cm-line\\.(${MULTILINE_BLOCK_CLASSES.join('|')})$`);

function isMultilineBlockSelectorList(selectorList: string): boolean {
	const sels = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
	return sels.length > 0 && sels.every((s) => BLOCK_SELECTOR_RE.test(s));
}

/** Expand a 1–4 value box shorthand into [top, right, bottom, left]. */
function expandBox(value: string): [string, string, string, string] {
	const p = value.split(/\s+/).filter(Boolean);
	if (p.length <= 1) return [value, value, value, value];
	if (p.length === 2) return [p[0], p[1], p[0], p[1]];
	if (p.length === 3) return [p[0], p[1], p[2], p[1]];
	return [p[0], p[1], p[2], p[3]];
}

/** Expand a 1–4 value border-radius shorthand into [TL, TR, BR, BL]. */
function expandRadius(value: string): [string, string, string, string] {
	const p = value.split(/\s+/).filter(Boolean);
	if (p.length <= 1) return [value, value, value, value];
	if (p.length === 2) return [p[0], p[1], p[0], p[1]];
	if (p.length === 3) return [p[0], p[1], p[2], p[1]];
	return [p[0], p[1], p[2], p[3]];
}

type Decl = { prop: string; value: string } | { raw: string };

function parseDeclarations(body: string): Decl[] {
	const items: Decl[] = [];
	let buf = '';
	let depth = 0;
	let i = 0;
	const n = body.length;
	const pushBuf = () => {
		const seg = buf.trim();
		buf = '';
		if (!seg) return;
		const colon = seg.indexOf(':');
		if (colon === -1) {
			items.push({ raw: seg }); // stray comment or malformed fragment — keep verbatim
			return;
		}
		items.push({ prop: seg.slice(0, colon).trim(), value: seg.slice(colon + 1).trim() });
	};
	while (i < n) {
		if (body[i] === '/' && body[i + 1] === '*') {
			const end = body.indexOf('*/', i + 2);
			const stop = end === -1 ? n : end + 2;
			buf += body.slice(i, stop);
			i = stop;
			continue;
		}
		const c = body[i];
		if (c === '(') depth++;
		else if (c === ')') depth = Math.max(0, depth - 1);
		if (c === ';' && depth === 0) {
			pushBuf();
			i++;
			continue;
		}
		buf += c;
		i++;
	}
	pushBuf();
	return items;
}

// Accumulates the declarations of one block rule, keeping the four edges of
// padding and margin separately so they can be recombined at emit time.
//
// The critical rule: a `.cm-line` must never carry `margin`. CodeMirror measures
// each line's box with getBoundingClientRect (border-box), which *excludes*
// margin, so any margin on a line becomes vertical space its height map never
// accounts for — and clicks / arrow-key motion then land on the wrong line by
// the accumulated margin. So every margin edge is folded into the corresponding
// padding edge (part of the measured box). Padding and margin are tracked apart
// because both can appear on the same rule (e.g. a heading with `padding-bottom`
// *and* `margin-bottom`); each keeps last-wins semantics on its own, then the
// two are summed with `calc()`.
interface BlockAcc {
	padTop?: string; marTop?: string;
	padBottom?: string; marBottom?: string;
	padLeft?: string; marLeft?: string;
	padRight?: string; marRight?: string;
	allOther: string[];
	firstOther: string[];
	lastOther: string[];
}

function distributeBlockDecl(prop: string, value: string, acc: BlockAcc): void {
	const p = prop.toLowerCase();
	const set = (edge: 'Top' | 'Bottom' | 'Left' | 'Right', kind: 'pad' | 'mar', v: string) => {
		// A theme's top margin is intentionally dropped rather than folded into
		// padding-top like every other edge. Real CSS collapses adjacent
		// vertical margins (only the larger of the two adjacent values takes
		// effect); a `.cm-line` has no such mechanism, and this app can't
		// know a rule's *previous sibling's* bottom margin at CSS-transform
		// time to replicate that collapse. Left uncorrected, every block
		// boundary stacks the previous block's bottom margin, this app's own
		// mandatory blank source line (blank lines are real, visible text
		// here, not just a parser separator the way they are in a rendered
		// static preview), *and* the next block's top margin — visibly wider
		// gaps than the same theme produces in a real rendered preview.
		// Keeping only the bottom-margin side (plus the blank line) is a
		// deliberate, imperfect approximation of collapsing: it recovers most
		// of the doubled space without needing cross-rule/cross-line context.
		if (kind === 'mar' && edge === 'Top') return;
		acc[`${kind}${edge}` as keyof BlockAcc] = v as never; // last-wins per edge, per kind
	};

	if (p === 'padding' || p === 'margin') {
		const kind = p === 'padding' ? 'pad' : 'mar';
		const [t, r, b, l] = expandBox(value);
		set('Top', kind, t); set('Right', kind, r); set('Bottom', kind, b); set('Left', kind, l);
		return;
	}
	if (p === 'padding-block' || p === 'margin-block') {
		const kind = p.startsWith('padding') ? 'pad' : 'mar';
		const [t, , b] = expandBox(value);
		set('Top', kind, t); set('Bottom', kind, b);
		return;
	}
	if (p === 'padding-inline' || p === 'margin-inline') {
		const kind = p.startsWith('padding') ? 'pad' : 'mar';
		const parts = value.split(/\s+/).filter(Boolean);
		set('Left', kind, parts[0]); set('Right', kind, parts[1] ?? parts[0]);
		return;
	}
	const spacing = /^(padding|margin)-(top|bottom|left|right|inline-start|inline-end)$/.exec(p);
	if (spacing) {
		const kind = spacing[1] === 'padding' ? 'pad' : 'mar';
		const side = spacing[2];
		const edge = side === 'top' ? 'Top' : side === 'bottom' ? 'Bottom'
			: side === 'left' || side === 'inline-start' ? 'Left' : 'Right';
		set(edge, kind, value);
		return;
	}

	if (p === 'border') {
		acc.allOther.push(`border-left: ${value}`, `border-right: ${value}`);
		acc.firstOther.push(`border-top: ${value}`);
		acc.lastOther.push(`border-bottom: ${value}`);
		return;
	}
	if (p === 'border-width' || p === 'border-style' || p === 'border-color') {
		const suffix = p.slice('border-'.length); // width | style | color
		const [t, r, b, l] = expandBox(value);
		acc.allOther.push(`border-left-${suffix}: ${l}`, `border-right-${suffix}: ${r}`);
		acc.firstOther.push(`border-top-${suffix}: ${t}`);
		acc.lastOther.push(`border-bottom-${suffix}: ${b}`);
		return;
	}
	// Includes border-top-*, and border-top-left/right-radius.
	if (p.startsWith('border-top')) return void acc.firstOther.push(`${prop}: ${value}`);
	if (p.startsWith('border-bottom')) return void acc.lastOther.push(`${prop}: ${value}`);
	if (p.startsWith('border-left') || p.startsWith('border-right')) return void acc.allOther.push(`${prop}: ${value}`);

	if (p === 'border-radius') {
		if (value.includes('/')) return void acc.allOther.push(`border-radius: ${value}`); // rare elliptical form
		const [tl, tr, br, bl] = expandRadius(value);
		acc.firstOther.push(`border-top-left-radius: ${tl}`, `border-top-right-radius: ${tr}`);
		acc.lastOther.push(`border-bottom-right-radius: ${br}`, `border-bottom-left-radius: ${bl}`);
		return;
	}

	// Everything else (background, color, font, line-height, box-shadow, …) applies
	// uniformly to every line.
	acc.allOther.push(`${prop}: ${value}`);
}

function accumulateBlock(body: string): BlockAcc {
	const acc: BlockAcc = { allOther: [], firstOther: [], lastOther: [] };
	for (const item of parseDeclarations(body)) {
		if ('raw' in item) acc.allOther.push(item.raw);
		else distributeBlockDecl(item.prop, item.value, acc);
	}
	return acc;
}

/** Sum a padding edge and its (margin→padding) companion; `calc()` only when both exist. */
function combineEdge(pad: string | undefined, mar: string | undefined): string | undefined {
	if (pad && mar) return `calc(${pad} + ${mar})`;
	return pad ?? mar;
}

function emitBlockRule(selectors: string[], decls: string[]): string {
	return decls.length ? `${selectors.join(', ')} {\n\t${decls.join(';\n\t')};\n}` : '';
}

function splitMultilineBlockRule(selectorList: string, body: string): string {
	const acc = accumulateBlock(body);
	const all = [...acc.allOther];
	const first = [...acc.firstOther];
	const last = [...acc.lastOther];
	const pl = combineEdge(acc.padLeft, acc.marLeft);
	const pr = combineEdge(acc.padRight, acc.marRight);
	const pt = combineEdge(acc.padTop, acc.marTop);
	const pb = combineEdge(acc.padBottom, acc.marBottom);
	if (pl) all.push(`padding-left: ${pl}`);
	if (pr) all.push(`padding-right: ${pr}`);
	if (pt) first.push(`padding-top: ${pt}`);
	if (pb) last.push(`padding-bottom: ${pb}`);

	const sels = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
	// Each selector's own block class (mlp-line-code, mlp-line-quote, …) determines
	// its matching `-first`/`-last` companion, e.g. `.cm-line.mlp-line-quote-first`.
	const withSuffix = (suffix: string) =>
		sels.map((s) => {
			const cls = BLOCK_SELECTOR_RE.exec(s)![1];
			return `${s}.${cls}-${suffix}`;
		});
	return [emitBlockRule(sels, all), emitBlockRule(withSuffix('first'), first), emitBlockRule(withSuffix('last'), last)]
		.filter(Boolean)
		.join('\n');
}

// A single-line `.cm-line` rule (headings, or any other line-targeting rule that
// isn't a multi-line block): no first/last distribution, but margins still must
// become padding so they stay inside CodeMirror's measured line box.
function flattenLineRule(selectorList: string, body: string): string {
	const acc = accumulateBlock(body);
	const decls = [...acc.allOther, ...acc.firstOther, ...acc.lastOther];
	const pt = combineEdge(acc.padTop, acc.marTop);
	const pb = combineEdge(acc.padBottom, acc.marBottom);
	const pl = combineEdge(acc.padLeft, acc.marLeft);
	const pr = combineEdge(acc.padRight, acc.marRight);
	if (pt) decls.push(`padding-top: ${pt}`);
	if (pb) decls.push(`padding-bottom: ${pb}`);
	if (pl) decls.push(`padding-left: ${pl}`);
	if (pr) decls.push(`padding-right: ${pr}`);
	return emitBlockRule([selectorList], decls);
}

// True when every selector targets a `.cm-line` (heading lines, or a mix of line
// kinds) but the list didn't qualify for the multi-line block path. Such rules
// still need their margins flattened to padding.
function isLineSelectorList(selectorList: string): boolean {
	const sels = selectorList.split(',').map((s) => s.trim()).filter(Boolean);
	return sels.length > 0 && sels.every((s) => /(^|\s|>)\.cm-line\b/.test(s));
}

// ── Rule walker ─────────────────────────────────────────────────────────────

function skipString(css: string, start: number): number {
	const quote = css[start];
	let i = start + 1;
	const n = css.length;
	while (i < n) {
		if (css[i] === '\\') {
			i += 2;
			continue;
		}
		if (css[i] === quote) return i + 1;
		i++;
	}
	return n;
}

/** Index of the `}` matching the `{` at `openIdx`, skipping comments and strings. */
function findMatchingBrace(css: string, openIdx: number): number {
	let depth = 0;
	let i = openIdx;
	const n = css.length;
	while (i < n) {
		if (css[i] === '/' && css[i + 1] === '*') {
			const end = css.indexOf('*/', i + 2);
			i = end === -1 ? n : end + 2;
			continue;
		}
		const c = css[i];
		if (c === '"' || c === "'") {
			i = skipString(css, i);
			continue;
		}
		if (c === '{') depth++;
		else if (c === '}' && --depth === 0) return i;
		i++;
	}
	return n; // unterminated — caller treats the remainder as the body
}

function extractLeadingComments(prelude: string): { comments: string; rest: string } {
	const m = /^(\s*(?:\/\*[\s\S]*?\*\/\s*)*)/.exec(prelude);
	const comments = m ? m[1] : '';
	return { comments, rest: prelude.slice(comments.length) };
}

function emitRule(prelude: string, body: string): string {
	const { comments, rest } = extractLeadingComments(prelude);
	const trimmed = rest.trim();
	if (trimmed.startsWith('@')) {
		// Conditional group at-rules wrap nested rules, so recurse into them; other
		// at-rules (@font-face, @keyframes, @page) hold plain declarations — leave as-is.
		if (/^@(media|supports|container|layer|scope|document)\b/i.test(trimmed)) {
			return `${comments}${rest}{${processRules(body)}}`;
		}
		return `${comments}${rest}{${body}}`;
	}
	const selectorList = transformSelectorList(rest);
	if (isPreCodeSelectorList(selectorList)) {
		return comments + splitPreCodeRule(selectorList, body);
	}
	if (isMultilineBlockSelectorList(selectorList)) {
		return comments + splitMultilineBlockRule(selectorList, body);
	}
	if (isLineSelectorList(selectorList)) {
		// Heading lines and other single-line `.cm-line` rules: flatten margins to
		// padding so they stay inside CodeMirror's measured line box.
		return comments + flattenLineRule(selectorList, body);
	}
	return `${comments}${selectorList}{${body}}`;
}

function processRules(css: string): string {
	let out = '';
	let prelude = '';
	let i = 0;
	const n = css.length;
	while (i < n) {
		// Preserve comments verbatim wherever they appear.
		if (css[i] === '/' && css[i + 1] === '*') {
			const end = css.indexOf('*/', i + 2);
			const stop = end === -1 ? n : end + 2;
			prelude += css.slice(i, stop);
			i = stop;
			continue;
		}
		const c = css[i];
		if (c === '{') {
			const close = findMatchingBrace(css, i);
			out += emitRule(prelude, css.slice(i + 1, close));
			prelude = '';
			i = close + 1;
			continue;
		}
		if (c === ';') {
			// Top-level statement (`@import …;`, `@charset …;`) — no selector to rewrite.
			out += prelude + ';';
			prelude = '';
			i++;
			continue;
		}
		prelude += c;
		i++;
	}
	out += prelude; // trailing whitespace / comments after the last rule
	return out;
}

export function adaptMarkdownCss(css: string): string {
	return processRules(css);
}
