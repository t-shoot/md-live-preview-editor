/**
 * Tiny message catalog for the webviews.
 *
 * `package.nls.*.json` localizes the manifest, but it cannot reach strings that
 * live inside a webview bundle — those run in their own document, with no
 * access to the extension host's l10n API. So the host stamps its locale onto
 * `window.mlpLocale` (see the webview HTML), and this module picks the matching
 * catalog at import time.
 *
 * English is the source language and the fallback: a key missing from a
 * translation falls back to its English text rather than rendering blank.
 */

/** Every user-visible webview string, keyed by a stable identifier. */
const en = {
	'code.toggle.title': 'Code mode: show the Markdown source and edit it directly',
	'code.toggle.aria': 'Switch to code mode',
	'code.copy.title': 'Copy this code block',
	'code.copy.aria': 'Copy code block',

	'zoom.in': 'Zoom in (Ctrl+wheel also works)',
	'zoom.out': 'Zoom out',
	'zoom.reset': 'Reset the view (fit to width)',
	'zoom.toActual': 'Switch to actual size (drag to pan, Ctrl+wheel to zoom)',
	'zoom.toFit': 'Back to fitted view (scaled to the available width, no scrolling)',

	'page.prev': 'Previous page',
	'page.next': 'Next page',

	'drawio.loading': 'Loading {0}…',
	'drawio.loadFailed': 'Failed to load the draw.io file: {0}',
	'drawio.parseFailed': 'Could not parse the XML. Check the contents of the draw.io file.',
	'drawio.emptyXml': 'The XML is empty.',
	'drawio.readFailed': 'Could not read the file.',
	'drawio.compressed':
		'Compressed draw.io files are not supported. Turn off "Compress XML" in draw.io and save the file again.',
	'drawio.noDiagram': 'No draw.io diagram was found.',
	'drawio.noConnection': 'The connection to the host is not established yet.',

	'frontmatter.parseFailed': 'Could not parse the front matter',

	'table.addRow': 'Add a row',
	'table.addColumn': 'Add a column',

	'render.toggle.title': 'Render mode: show this as its rendered view again',
	'render.toggle.aria': 'Switch back to rendered view',

	'outline.empty': 'No headings.',
	'outline.untitled': '(untitled heading)',
	'outline.noDocument': 'Open a Markdown Live Preview document to see its headings here.',

	'sidebar.applied': 'Applied',
	'sidebar.editCss': 'Edit CSS',
	'sidebar.duplicate': 'Duplicate',
	'sidebar.rename': 'Rename',
	'sidebar.delete': 'Delete',
	'sidebar.settings': 'Settings',
	'sidebar.defaultEditor': 'Default editor',
	'sidebar.defaultEditor.prompt': 'Normal editor (preview manually)',
	'sidebar.defaultEditor.livePreview': 'Always Live Preview',
	'sidebar.defaultEditor.default': 'Always the normal editor',
	'sidebar.codeTheme': 'Code palette',
	'sidebar.codeTheme.auto': 'Auto (follow VS Code)',
	'sidebar.cssThemes': 'CSS Themes',
	'sidebar.noStyles': 'No styles yet.',
	'sidebar.pickHint': 'Click a card to apply it (only one can be active).',
	'sidebar.newStyle': '+ New style',

	// Sample copy shown inside the CSS-theme previews. It is translated so the
	// preview reads naturally, and because line height and letter spacing look
	// different in a script the reader actually uses.
	'sample.h1': 'Heading 1',
	'sample.h2': 'Heading 2',
	'sample.h3': 'Heading 3',
	'sample.body': 'Body text with {0}, {1}, {2}, {3} and a {4}.',
	'sample.bold': 'bold',
	'sample.italic': 'italic',
	'sample.strike': 'strikethrough',
	'sample.link': 'link',
	'sample.bullet1': 'Bullet 1',
	'sample.bullet2': 'Bullet 2',
	'sample.nested': 'Nested item',
	'sample.ordered1': 'Ordered 1',
	'sample.ordered2': 'Ordered 2',
	'sample.quote': 'An example blockquote.',
	'sample.quoteLong': 'An example blockquote — how a citation or a note looks.',
	'sample.paragraph2': 'Another paragraph, so you can judge line height and letter spacing.',
	'sample.taskDone': 'Completed task',
	'sample.taskTodo': 'Unfinished task',
	'sample.tableHeading': 'Table',
	'sample.codeHeading': 'Code block',
	'sample.colA': 'Column A',
	'sample.colB': 'Column B',
	'sample.colC': 'Column C',
	'sample.cell1': 'alpha',
	'sample.cell2': 'beta',
	'sample.belowRule': 'A paragraph below the horizontal rule.',
	'sample.comment': 'a comment',

	// Labels inside @codemirror/search's own panel, fed to it through
	// CodeMirror's `phrases` facet so the widget matches the rest of the UI.
	'search.find': 'Find',
	'search.replace': 'Replace',
	// The panel uses a capitalized "Replace" for the field's placeholder and a
	// lowercase "replace" for the button, so both are mapped.
	'search.replaceButton': 'replace',
	'search.next': 'next',
	'search.previous': 'previous',
	'search.all': 'all',
	'search.matchCase': 'match case',
	'search.regexp': 'regexp',
	'search.byWord': 'by word',
	'search.replaceAll': 'replace all',
	'search.close': 'close',
	'search.currentMatch': 'current match',
	'search.gotoLine': 'Go to line',
	'search.go': 'go',
	'search.onLine': 'on line',
	'search.toggleReplace': 'Toggle Replace',
};

/** A message key. Translations are checked against this at compile time. */
export type MessageKey = keyof typeof en;

const ja: Record<MessageKey, string> = {
	'code.toggle.title': 'コードモード：Markdown ソースを表示して直接編集します',
	'code.toggle.aria': 'コードモードに切り替え',
	'code.copy.title': 'このコードブロックをコピーします',
	'code.copy.aria': 'コードブロックをコピー',

	'zoom.in': '拡大 (Ctrl+ホイールでも可)',
	'zoom.out': '縮小',
	'zoom.reset': '元の表示に戻す（縮小表示）',
	'zoom.toActual': '原寸大表示に切り替え（ドラッグでパン、Ctrl+ホイールでズームできます）',
	'zoom.toFit': '自動縮小表示に戻す（表示幅に合わせて縮小し、スクロールなしで全体を表示します）',

	'page.prev': '前のページ',
	'page.next': '次のページ',

	'drawio.loading': '{0} を読み込んでいます…',
	'drawio.loadFailed': 'draw.io の読み込みに失敗しました: {0}',
	'drawio.parseFailed': 'XML を解析できませんでした。draw.io ファイルの内容を確認してください。',
	'drawio.emptyXml': 'XML が空です。',
	'drawio.readFailed': 'ファイルを読み込めませんでした。',
	'drawio.compressed':
		'圧縮された draw.io ファイルには対応していません。draw.io で「XML を圧縮」を無効にして保存し直してください。',
	'drawio.noDiagram': 'draw.io の図が見つかりませんでした。',
	'drawio.noConnection': 'ホストへの接続がまだ確立していません。',

	'frontmatter.parseFailed': 'フロントマターの解析に失敗しました',

	'table.addRow': '行を追加',
	'table.addColumn': '列を追加',

	'render.toggle.title': 'レンダリングモード：表示済みの見た目に戻します',
	'render.toggle.aria': '表示済みの見た目に戻す',

	'outline.empty': '見出しがありません。',
	'outline.untitled': '(無題の見出し)',
	'outline.noDocument': 'Markdown Live Preview を開くと、ここに見出し一覧が表示されます。',

	'sidebar.applied': '適用中',
	'sidebar.editCss': 'CSSを編集',
	'sidebar.duplicate': '複製',
	'sidebar.rename': '名前を変更',
	'sidebar.delete': '削除',
	'sidebar.settings': '設定',
	'sidebar.defaultEditor': '既定エディタ',
	'sidebar.defaultEditor.prompt': '通常エディタ（手動でプレビュー）',
	'sidebar.defaultEditor.livePreview': '常にライブプレビュー',
	'sidebar.defaultEditor.default': '常に通常エディタ',
	'sidebar.codeTheme': 'コード配色',
	'sidebar.codeTheme.auto': '自動（VS Codeに追従）',
	'sidebar.cssThemes': 'CSSテーマ',
	'sidebar.noStyles': 'スタイルがまだありません。',
	'sidebar.pickHint': 'カードをクリックして適用（1つだけ選べます）。',
	'sidebar.newStyle': '+ 新しいスタイル',

	'sample.h1': '見出し 1',
	'sample.h2': '見出し 2',
	'sample.h3': '見出し 3',
	'sample.body': '本文と{0}、{1}、{2}、{3}、そして{4}。',
	'sample.bold': '太字',
	'sample.italic': '斜体',
	'sample.strike': '取り消し線',
	'sample.link': 'リンク',
	'sample.bullet1': '箇条書き 1',
	'sample.bullet2': '箇条書き 2',
	'sample.nested': 'ネストした項目',
	'sample.ordered1': '番号付きリスト 1',
	'sample.ordered2': '番号付きリスト 2',
	'sample.quote': '引用ブロックの例。',
	'sample.quoteLong': '引用ブロックの例。出典やメモを引用するときの見た目です。',
	'sample.paragraph2': 'もう一つの段落。行間や字間の見え方を確認できます。',
	'sample.taskDone': '完了したタスク',
	'sample.taskTodo': '未完了のタスク',
	'sample.tableHeading': 'テーブル',
	'sample.codeHeading': 'コードブロック',
	'sample.colA': '列 A',
	'sample.colB': '列 B',
	'sample.colC': '列 C',
	'sample.cell1': 'あいうえお',
	'sample.cell2': 'かきくけこ',
	'sample.belowRule': '水平線の下の段落。',
	'sample.comment': 'コメント',

	'search.find': '検索',
	'search.replace': '置換',
	'search.replaceButton': '置換',
	'search.next': '次へ',
	'search.previous': '前へ',
	'search.all': 'すべて',
	'search.matchCase': '大文字と小文字を区別',
	'search.regexp': '正規表現',
	'search.byWord': '単語単位',
	'search.replaceAll': 'すべて置換',
	'search.close': '閉じる',
	'search.currentMatch': '現在の一致',
	'search.gotoLine': '行へ移動',
	'search.go': '移動',
	'search.onLine': '行',
	'search.toggleReplace': '置換の表示を切り替え',
};

const catalogs: Record<string, Partial<Record<MessageKey, string>>> = { ja };

/**
 * Resolves the catalog for a VS Code locale tag. Only the primary subtag is
 * significant, so "ja-JP" and "ja" pick the same catalog; anything without a
 * translation falls through to English.
 */
export function catalogFor(locale: string | undefined): Partial<Record<MessageKey, string>> {
	const primary = (locale ?? '').toLowerCase().split(/[-_]/)[0];
	return catalogs[primary] ?? {};
}

/** The locale the host stamped onto the webview document, if any. */
function hostLocale(): string | undefined {
	return typeof globalThis === 'undefined'
		? undefined
		: (globalThis as { mlpLocale?: string }).mlpLocale;
}

const active = catalogFor(hostLocale());

/**
 * Looks up `key`, substituting `{0}`, `{1}`, … with `args`.
 *
 * Falls back to the English text when the active catalog has no entry, so a
 * partial translation degrades to mixed language rather than to blanks.
 */
export function t(key: MessageKey, ...args: string[]): string {
	const template = active[key] ?? en[key];
	return args.length === 0
		? template
		: template.replace(/\{(\d+)\}/g, (whole, index: string) => args[Number(index)] ?? whole);
}

/**
 * Escapes a value for interpolation into a double-quoted HTML attribute.
 *
 * `vscode.env.language` is a well-formed tag in practice, but it reaches the
 * webview's `<html lang>` as untrusted input, so it is escaped rather than
 * trusted.
 */
export function escapeAttribute(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
