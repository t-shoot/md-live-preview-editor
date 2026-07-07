import type { HostToPreviewMessage, PreviewToHostMessage } from '../shared/messages';

interface VsCodeApi {
	postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;
const api = acquireVsCodeApi();

function post(message: PreviewToHostMessage): void {
	api.postMessage(message);
}

// A representative Markdown document (as real HTML) covering the elements a theme
// styles, so the author sees the full effect of their CSS as they type. Theme CSS
// is authored for VS Code's Markdown preview, i.e. against real <body>/<h1>/… —
// so it applies here directly, no adaptation needed.
const SAMPLE_HTML = `
<h1>見出し 1 (Heading 1)</h1>
<p>これは本文の段落です。<strong>太字</strong>、<em>斜体</em>、<del>取り消し線</del>、
<code>inline code</code>、そして <a href="#">リンク</a> を含みます。</p>

<h2>見出し 2 (Heading 2)</h2>
<p>もう一つの段落。日本語と English が混ざった文章でも、行間や字間の見え方を確認できます。</p>

<blockquote>
	<p>引用ブロックの例。出典やメモを引用するときの見た目です。</p>
</blockquote>

<h3>見出し 3 (Heading 3)</h3>
<ul>
	<li>箇条書きの項目 1</li>
	<li>箇条書きの項目 2
		<ul><li>ネストした項目</li></ul>
	</li>
</ul>
<ol>
	<li>番号付きリスト 1</li>
	<li>番号付きリスト 2</li>
</ol>

<ul class="contains-task-list">
	<li><input type="checkbox" checked disabled> 完了したタスク</li>
	<li><input type="checkbox" disabled> 未完了のタスク</li>
</ul>

<h3>テーブル (Table)</h3>
<table>
	<thead><tr><th>列 A</th><th>列 B</th><th>列 C</th></tr></thead>
	<tbody>
		<tr><td>1</td><td>あいうえお</td><td>x</td></tr>
		<tr><td>2</td><td>かきくけこ</td><td>y</td></tr>
	</tbody>
</table>

<h3>コードブロック (Code block)</h3>
<pre><code>function greet(name) {
  // コメント
  return \`Hello, \${name}!\`;
}
</code></pre>

<hr />
<p>水平線の下の段落。</p>
`;

const themeStyle = document.getElementById('mlp-theme-style') as HTMLStyleElement;
const content = document.getElementById('mlp-preview-content')!;
content.innerHTML = SAMPLE_HTML;

const HL_CLASS = 'mlp-hl';
const THEME_KINDS = ['vscode-light', 'vscode-dark', 'vscode-high-contrast'];

function setThemeKind(kind: string): void {
	// Swap only the theme-kind class so a highlight on <body> (from a `body` rule)
	// isn't wiped when the CSS is re-pushed.
	document.body.classList.remove(...THEME_KINDS);
	document.body.classList.add(kind);
}

function clearHighlight(): void {
	document.querySelectorAll('.' + HL_CLASS).forEach((el) => el.classList.remove(HL_CLASS));
}

function tryQuery(selector: string): Element[] {
	try {
		// Query the whole document so `body`, `body.vscode-dark h1`, etc. resolve
		// against the real <body> (which carries the theme-kind class).
		return Array.from(document.querySelectorAll(selector));
	} catch {
		return []; // invalid/unsupported selector
	}
}

function applyHighlight(selector: string | null): void {
	clearHighlight();
	if (!selector) return;
	const sel = selector.trim();
	if (!sel || sel.startsWith('@')) return; // at-rule prelude — nothing to point at

	let els = tryQuery(sel);
	if (els.length === 0) {
		// The rule may be gated on the *other* theme mode (e.g. `body.vscode-dark h1`
		// while the preview is light). Retry with the `body.vscode-*` gate removed so
		// the author still sees which element the rule targets.
		const stripped = sel
			.split(',')
			.map((s) => s.replace(/\bbody(?:\.[-\w]+)*\s*/g, '').trim())
			.filter(Boolean)
			.join(', ');
		els = stripped ? tryQuery(stripped) : [document.body];
	}
	els.forEach((el) => el.classList.add(HL_CLASS));
}

window.addEventListener('message', (event: MessageEvent<HostToPreviewMessage>) => {
	const message = event.data;
	if (message.type === 'update') {
		themeStyle.textContent = message.css;
		// The theme's `body.vscode-dark` / `.vscode-light` gates key off this class.
		setThemeKind(message.themeKind);
	} else if (message.type === 'highlight') {
		applyHighlight(message.selector);
	}
});

post({ type: 'ready' });
