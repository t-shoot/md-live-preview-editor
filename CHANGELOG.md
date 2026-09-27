# Changelog

[日本語](#日本語) | English

All notable changes to this extension are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [0.3.0] — 2026-09-28

### Changed

- **Tables, Mermaid/draw.io diagrams, and YAML frontmatter now switch between
  their rendered view and raw source only through their own buttons.**
  Previously the caret's mere position decided this, so opening a document
  that started with one of these, searching for text inside one, or tabbing
  between table cells could flip it to raw text without being asked. Diagrams
  and frontmatter gained the same "back to rendered view" button tables
  already had (next to the existing `</>` button that reveals the source),
  and frontmatter's raw YAML now gets the same tinted background a raw table
  or a fenced code block gets, instead of none at all.

### Fixed

- **Bold, italic, strikethrough, list markers, and inline code no longer
  reveal their raw Markdown just because the caret is elsewhere on the same
  line.** Editing the end of a list item's text showed its raw `-`, and a
  `**bold**` run elsewhere on the line stayed exposed too — both now react
  only to the caret actually touching them.
- Dragging to select text starting exactly on a bullet point (`•`) now starts
  the selection; it previously did nothing, since the bullet ignored the
  press that began it.
- Drag-selected text stays visible inside a fenced code block. Depending on
  the color theme, the highlight could render fully invisible there, hidden
  behind the code block's own background.
- Finishing an edit in a table cell (`Escape`, `Enter`, or clicking a
  different cell) no longer leaves a stray cursor visible elsewhere in the
  document.

## [0.2.0] — 2026-09-10

### Added

- **Search and replace** (`Ctrl+F`), in a panel that floats over the top-right
  of the editor the way VS Code's own does. Replace is collapsed behind a
  chevron, since finding is much the more common of the two. `Enter`/`F3` step
  through matches, `Ctrl+D` adds the next occurrence as a cursor, `Esc` closes
  the panel; case, whole-word and regular-expression modes are all available.
  Searching runs against the raw Markdown, so `](url)`, a table's pipes and a
  heading's `#` are findable while the preview hides them — and a match inside
  hidden syntax reveals that syntax, so what was found is always visible.
- **Multiple cursors now actually work.** The editor never enabled CodeMirror's
  multiple-selection support, so the multi-cursor behaviour `Ctrl+B`/`Ctrl+I`
  already documented had no way to arise, and `Ctrl+D` would have collapsed to
  a single cursor.
- `.markdown` files open in the live preview, alongside `.md`.

### Changed

- **The UI now speaks the language VS Code is set to**, defaulting to English.
  Every menu, button, tooltip and message was previously hardcoded in Japanese,
  so anyone not reading Japanese met a Japanese UI on install. Language follows
  VS Code's own display language — not the content of the document — so an
  English `.md` in a Japanese VS Code still shows a Japanese UI, and nothing you
  write is ever translated.
- The CSS-theme preview samples are translated too. They exist to judge line
  height and letter spacing, which only works in a script you actually read.
- The Marketplace description now leads with `.drawio` rendering, which no
  other Markdown extension offers.

### Fixed

- **A rendered image could not be edited.** Clicking one placed no caret,
  because a widget ignores every event unless it says otherwise — so the line
  never gained a cursor and the `![alt](url)` behind it stayed hidden. Dragging
  across the URL to select it had the same problem, and searching for part of
  it scrolled to the image but left it rendered.
- **The text cursor was black on dark themes.** The editor draws its own caret
  to support multiple cursors, and the library default for that is a hardcoded
  black; it now follows the VS Code theme like the native caret already did.
- Removed a leftover `**/temp/readonly/*` file pattern that let this editor
  claim unrelated files.
- The "CSS Themes" sidebar view had a blank title (a single space).

### Note on the version number

`0.1.0` was prepared but never published, so its changes are listed here.
Search and replace is one of the things `1.0.0` is waiting on; math, footnotes,
callouts and export are still missing.

## [0.0.12] — 2026-09-02

### Added

- **draw.io diagrams render in place**, the same way a Mermaid diagram already
  does. Write one two ways: a ` ```drawio ` fence holding the diagram XML, or a
  `![](diagram.drawio)` reference to a `.drawio` file sitting beside the
  document. Putting the cursor in a fence reveals its source, as with every
  other block. A file with more than one page shows a page indicator in its
  toolbar.
- **AWS architecture shapes are included**, so a diagram drawn with them shows
  the intended symbols rather than a grid of plain boxes. Shape colours come
  from the diagram file itself — nothing is substituted or re-themed, in either
  a light or a dark editor.

### Security

- A `.drawio` file reference is read only from the document's own folder tree,
  and only up to 5MB. The path in a `![](…)` is just text in the document, so
  without this an opened Markdown file could have pointed at any path on disk.

## [0.0.11] — 2026-09-01

### Added

- **Editable tables.** A table now stays rendered while you work in it, in the
  style of Obsidian's table editor. Clicking a cell makes that one cell
  editable in place and shows its raw Markdown, so `**bold**` survives a
  round-trip; `Tab`/`Shift+Tab` move between cells, `Enter` commits and `Esc`
  discards. Only the edited cell's own span is written back, leaving the rest
  of the row's text, padding and pipes byte-identical, so an edit cannot
  reflow the source or break the table's structure. Column widths are pinned
  for the duration of an edit, so swapping a cell's rendered text for its
  longer source no longer makes the whole table lurch sideways.
- **A `</>` code-mode button on every rendered block** — tables, Mermaid
  diagrams, frontmatter, and fenced code blocks — for reaching the Markdown
  behind it. Cell editing cannot change a table's *structure* (adding a row,
  editing the alignment row, repairing a broken table), so there has to be a
  deliberate way back to the source; giving every block the same control puts
  it in the same place whatever the block is. On a code block, whose text is
  already visible, it reveals the ` ``` ` fence lines and puts the caret on
  the language tag.
- **A `⧉` copy button on fenced code blocks.** Selecting a code block by hand
  sweeps up the hidden ` ``` ` fence lines and any indentation the block is
  nested under; the button copies the block's contents exactly.
- **Adding a row or a column to a table**, from thin strips along its bottom and
  right edges. Unlike a cell edit, which rewrites one span, these rebuild the
  table whole — a new column has to appear in the header, the delimiter row and
  every data row at once — while keeping the column alignments and the
  indentation of a table nested under a list item.

### Changed

- **Clicking a Mermaid diagram now pans it instead of switching to its
  source.** Any click whose movement fell under the drag threshold used to be
  read as "show me the source", so a diagram would turn into raw text
  mid-gesture, exactly when it was being panned or zoomed. The `</>` button is
  the way to the source now, and the two can no longer be confused.
- **Table cell text can be selected and copied.** Dragging across cells
  highlights their text as ordinary text; previously the press was cancelled
  outright, so the rendered cells could not be selected at all.
- **Clicking a link follows it.** Opening a link used to require Ctrl/Cmd-click;
  a plain click fell through to the editor, which put the caret in the text and
  unrendered the link into its `[label](url)` source. Ctrl/Cmd-click still
  works.

### Fixed

- **Text typed into a table cell being written twice.** Committing a cell
  re-renders the table, and the DOM swap that follows fired `focusout` on the
  old element, committing it a second time — so `Enter`, `Tab` and a structural
  edit each turned "oneXY" into "oneXYXY".
- **`Tab` losing whatever was typed in the cell it moved to.** The commit that
  precedes the move rebuilds the widget, replacing every cell element, so the
  destination held across it was a node no longer in the document — and the
  keyboard handler still lived on the discarded table, leaving `Enter`, `Esc`
  and further `Tab`s dead in the new cell.
- **A rendered block flipping to its raw source on a stray click.** Clicking
  near a table — its outer edge, the shared line between two rows, the strip
  above it — or simply clicking repeatedly could revert it to pipe text, often
  several times in a row. Three separate causes: the caret was being dragged
  *through* a block on the way somewhere else and that counted as entering it;
  the browser's own word-selection on the second click of a rapid pair looked
  like a drag-select and made the handler bail out; and the block's own bounds
  were tested rather than its surrounding box, leaving unguarded bands (30px
  above a table, 7px below) that belonged to no block at all. The guards apply
  only to block widgets: they also gate whether a heading shows its `#` and
  whether `**bold**` shows its asterisks, so applying them everywhere would
  stop a click placing the caret for editing on any ordinary line.
- **Links to files failing with an OS "file not found (0x2)" dialog.** Every
  link was passed to the shell via `Uri.parse`, which is right only for one
  that already carries a scheme. A relative link — `./notes.md`, `../img/a.png`,
  or a bare `notes.md`, the ordinary case in a Markdown file — parsed into a
  scheme-less URI that resolved against nothing. Relative links are now resolved
  against the document's own folder and opened in the editor, with a fragment
  (`#heading`) split off and percent-encoding decoded first; a missing target
  gets a message naming the path instead of an OS error.
- **A Mermaid diagram's reset (`↺`) not returning to the size it started at.**
  It reset the zoom but stayed in full-size mode, whose 1× is the diagram's
  natural width — so from a zoomed-in view the diagram shrank part-way and
  stopped, still larger than the fitted view it began from. It now goes all
  the way back.
- **Table cells rendering differently from every other Markdown renderer once
  their content got the least bit involved.** A cell's content is drawn outside
  CodeMirror, so it was rendered by a handful of hand-written regexes rather
  than by the parser. Anything past one flat construct came out wrong:
  `***bold italic***` kept stray asterisks, `**a *b* c**` and `**2 * 3**`
  collapsed into nonsense, `_underscore_` emphasis and images were not
  recognised at all, a lone `*` used as a multiplication sign turned into
  spurious italics, multi-backtick code spans broke apart, links with a title
  stayed raw text, and a link nested in bold never became a link. Cells now go
  through the same parser the rest of the document uses, so they follow GFM
  exactly. Backslash escapes, `<`/`&`, autolinks and `<br>` are handled too;
  any other raw HTML in a cell is shown literally rather than injected.
- **Column alignment (`|:--|:-:|--:|`) was ignored.** Every column rendered
  left-aligned.
- **Rows with too few or too many cells rendered ragged.** GFM fixes a table's
  column count at its delimiter row: short rows are now padded with empty cells
  and any overflow is dropped, so the table stays rectangular.

## [0.0.10] — 2026-08-27

### Fixed

- **Cursor landing on the wrong line, and jumpy scrolling.** Rendered tables,
  Mermaid diagrams, and frontmatter blocks carried their spacing as a CSS
  `margin`, which sits outside the box CodeMirror measures. Each one quietly
  dropped 14px from the editor's internal height map, and the error accumulated
  down the document — a click near the top of a file landed one line off, and
  further down, three. Documents with many tables or diagrams were worst
  affected. The spacing now lives inside the measured box, so positions match
  the rendering exactly, at any scroll position.
- **Layout lurching when a Mermaid diagram finished rendering.** Diagrams render
  asynchronously, and the editor was never told the block had grown from a
  one-line placeholder to its full height. The same applies to images as they
  load, and to the diagram fit/native toggle.
- **The caret jumping a line away after pressing Enter at the end of a
  paragraph**, then snapping back as soon as you typed. A paragraph now includes
  the blank line that follows it, so its trailing gap sits below that separator
  instead of above it. Rendering is unchanged.

### Added

- Claude Code's read-only output tabs can now be opened in the live preview via
  **Reopen Editor With…**. These are in-memory documents with no file extension,
  so the `*.md` association could never match them.

## [0.0.9] — 2026-07-28

### Fixed

- Tables placed directly under a list item with no blank line between them were
  left as raw text instead of being rendered.

## [0.0.6] – [0.0.8] — 2026-07-23

### Changed

- Marketplace screenshots recropped to show only the editor itself.

## [0.0.5] — 2026-07-23

### Added

- **Bold / italic keyboard shortcuts** (`Ctrl+B` / `Ctrl+I`).
- **Paste and drag-and-drop images.** Dropped files are saved under an `assets/`
  folder beside the document and linked with a plain relative path.
- **Outline view** in the sidebar, listing the document's headings.

### Fixed

- Pasting an image while the cursor sat inside a table corrupted the table.

## [0.0.4] — 2026-07-16

### Changed

- Marketplace listing adjustments.

## [0.0.3] — 2026-07-13

### Added

- **Mermaid fit / native display toggle**, with drag-to-pan and Ctrl+wheel zoom
  in native mode.
- Markdown editing conveniences: auto-pairing for emphasis marks and code
  fences, and automatic spacing after a heading marker.

### Fixed

- Frontmatter in a document stopped every other decoration in the file from
  rendering.
- Doubled vertical spacing on list items and blockquotes.
- Markdown files opened by another extension (an AI chat panel's file link, for
  instance) stayed in the plain text editor instead of switching to the live
  preview.

### Changed

- New installs now start with the VS Code-standard sample theme applied.

## [0.0.2] — 2026-07-09

### Fixed

- CSS theme loading, live-preview auto-reopen, and Mermaid rendering.

## [0.0.1] — 2026-07-08

- Initial Marketplace release.

---

## 日本語

この拡張機能の主な変更点をまとめています。
バージョン番号は [セマンティック バージョニング](https://semver.org/lang/ja/) に従っています。

## [0.3.0] — 2026-09-28

### 変更

- **テーブル・Mermaid/draw.io の図・YAML フロントマターが、表示済みの見た目と
  生の記法をボタンでのみ切り替えるようになりました。** これまではカーソルの
  位置だけで切り替わっていたため、これらのいずれかで始まる文書を開いた瞬間や、
  内容を検索でヒットさせたとき、テーブルのセル間を Tab で移動したときなどに、
  意図せず生の記法に変わってしまうことがありました。図とフロントマターにも、
  テーブルに既にあった「表示済みの見た目に戻る」ボタンを追加しました(生の記法を
  表示する既存の `</>` ボタンの隣にあります)。また、フロントマターの生の YAML
  表示にも、テーブルやコードブロックの生表示と同じ色付きの背景を付けるように
  しました(これまでは背景が付いていませんでした)。

### 修正

- **太字・斜体・取り消し線・箇条書きの記号・インラインコードが、同じ行の
  離れた場所にカーソルがあるだけで生のMarkdown記法を表示してしまう問題を
  修正しました。** 箇条書き項目の末尾を編集しただけで生の `-` が表示されたり、
  行の別の場所にある `**太字**` の記号が表示されたままになる問題があり、
  カーソルが実際にその部分に触れているときだけ反応するようにしました。
- 箇条書きの「•」の真上からドラッグして選択を始められるようになりました。
  以前は「•」がクリックを無視してしまい、そこから始まる選択操作が
  何も起こりませんでした。
- コードブロックの中で選択した文字が見えるようになりました。配色テーマに
  よっては、選択のハイライトがコードブロック自体の背景色に隠れて
  完全に見えなくなることがありました。
- テーブルのセルの編集を終えたとき(`Escape`・`Enter`・別セルのクリック)、
  文書内の別の場所にカーソルが一瞬表示されてしまう問題を修正しました。

## [0.2.0] — 2026-09-10

### 追加

- **検索・置換**(`Ctrl+F`)。VS Code 標準と同じく、エディタ右上に浮かぶパネルです。
  置換は矢印を押したときだけ開きます(検索の方が使う頻度が高いため)。
  `Enter`/`F3`で一致箇所を移動、`Ctrl+D`で次の一致をカーソルとして追加、`Esc`で閉じます。
  大文字小文字の区別、単語単位、正規表現に対応しています。検索対象は素の Markdown なので、
  プレビューが隠している`](url)`や表のパイプ、見出しの`#`も検索できます。
  隠れた記法の中に一致が見つかった場合はその記法が表示されるため、
  何が見つかったのかを必ず目で確認できます。
- **複数カーソルが実際に動くようになりました。** CodeMirror の複数選択機能が
  有効になっていなかったため、`Ctrl+B`/`Ctrl+I`の説明にあった複数カーソル対応は
  そもそも発生しようがなく、`Ctrl+D`も単一カーソルに潰れる状態でした。
- `.md` に加えて `.markdown` もライブプレビューで開くようになりました。

### 変更

- **UI が VS Code の表示言語に追従するようになりました**(既定は英語)。
  これまでメニュー・ボタン・ツールチップ・メッセージがすべて日本語固定で、
  日本語を読まない利用者はインストール直後に日本語の UI に出会っていました。
  判定に使うのは **VS Code 本体の表示言語**で、開いている文書の中身ではありません。
  日本語の VS Code で英語の `.md` を開いても UI は日本語のままで、
  書いた内容が翻訳されることは一切ありません。
- CSS テーマのプレビュー用サンプル文も翻訳しました。行間や字間を確認するための
  ものなので、実際に読む文字で表示する方が役に立つためです。
- Marketplace の説明文を、他のどの Markdown 拡張機能にもない `.drawio` の描画から
  始まるように書き直しました。

### 修正

- **画像の URL を編集できませんでした。** 画像をクリックしてもカーソルが置かれず、
  そのため`![alt](url)`が表示されないままでした(ウィジェットは既定ですべての
  イベントを無視するためです)。ドラッグして URL を選択しようとした場合も同様で、
  URL の一部を検索した場合は画像までは移動するものの、画像は描画されたままでした。
- **ダークテーマでカーソルが黒く見づらい問題を修正しました。** 複数カーソルのために
  エディタが独自にカーソルを描くようになり、その既定色が黒固定だったためです。
  従来と同じく VS Code のテーマ色に追従するようにしました。
- 開発時の名残だった `**/temp/readonly/*` のパターンを削除しました。
  無関係なファイルをこのエディタが開いてしまう可能性がありました。
- サイドバーの「CSSテーマ」の見出しが空白 1 文字で、表示されていませんでした。

### バージョン番号について

`0.1.0` は用意しましたが公開しなかったため、その内容もここにまとめています。
検索・置換は `1.0.0` の条件の 1 つです。数式・脚注・コールアウト・書き出しは
まだありません。

## [0.0.12] — 2026-09-02

### 追加

- **draw.io の図をその場で表示できるようになりました。** Mermaid と同じ扱いです。
  書き方は2通りあります。ひとつは ` ```drawio ` の囲みの中に図の XML を書く方法、
  もうひとつは `![](diagram.drawio)` のように、文書のとなりに置いた `.drawio`
  ファイルを参照する方法です。囲みの中にカーソルを置くと、ほかのブロックと
  同じように元のテキストが表示されます。ページが複数ある図では、ページ番号が
  ツールバーに表示されます。
- **AWS のアーキテクチャ図形を同梱しました。** これがないと AWS の図形で描いた
  図がただの四角の羅列になってしまいます。図形の色は図のファイルに書かれた色を
  そのまま使います。明るいテーマでも暗いテーマでも、色を置き換えたり塗り直したり
  はしません。

### セキュリティ

- `.drawio` ファイルの読み込みは、その文書があるフォルダの中だけに限定し、
  大きさも 5MB までとしました。`![](…)` に書かれたパスは文書の中の「ただの文字」
  なので、この制限がないと、受け取った Markdown を開いただけでパソコン内の
  どのファイルでも読まれてしまうおそれがあります。

## [0.0.11] — 2026-09-01

### 追加

- **テーブルをその場で編集できるようになりました。** Obsidian のテーブル
  エディタと同じように、表は描画されたままで作業できます。セルをクリックすると
  そのセルだけが編集状態になり、生の Markdown が表示されるので `**太字**` の
  ような装飾も保ったまま直せます。`Tab`/`Shift+Tab` でセル間を移動、`Enter` で
  確定、`Esc` で取り消しです。書き戻すのは編集したセルの範囲だけなので、行の
  ほかの文字・空白・`|` は一切変わりません。編集が表の形を崩すことはありません。
  編集中は列幅を固定するので、短い表示から長いソースに変わっても表全体が
  横に大きく動くことはありません。
- **描画されたブロックすべてに `</>`（コードモード）ボタンを追加しました。**
  テーブル・Mermaid・フロントマター・コードブロックが対象です。セル編集では
  行の追加や区切り行の変更といった「構造」は変えられないため、元の Markdown に
  戻る明確な入口が必要でした。どのブロックでも同じ位置に同じボタンがあります。
  コードブロックは元から文字が見えているので、このボタンでは隠れている
  ` ``` ` の囲み行を表示し、言語名のところにカーソルを置きます。
- **コードブロックに `⧉`（コピー）ボタンを追加しました。** 手で範囲選択すると
  隠れている ` ``` ` の囲み行や、入れ子のときの字下げまで一緒に入ってしまいます。
  このボタンは中身だけを正確にコピーします。
- **テーブルに行・列を追加できるようになりました。** 表の下端と右端にある細い
  バーから追加します。セル編集が1マスだけを書き換えるのに対し、こちらは表全体を
  作り直します（列を足すには見出し行・区切り行・すべてのデータ行を同時に
  変える必要があるためです）。列揃えの指定や、箇条書き直下のテーブルの字下げは
  そのまま保たれます。

### 変更

- **Mermaid の図をクリックしても、ソース表示に切り替わらなくなりました。**
  これまでは、ドラッグと判定されない程度の小さな動きはすべて「ソースを見たい」
  と解釈していたため、図を動かそう・拡大しようとした最中に生テキストへ化けて
  いました。ソースを見るのは `</>` ボタンの役割にしたので、移動の操作と
  取り違えることがなくなりました。
- **表のセルの文字を選択してコピーできるようになりました。** セルをなぞると
  普通の文字と同じように選択できます。これまではマウスを押した時点で標準の
  動作を打ち消していたため、そもそも選択できませんでした。
- **リンクをクリックすると、そのまま開くようになりました。** これまでは
  Ctrl/Cmd を押しながらクリックする必要があり、普通にクリックするとエディタ側の
  処理になってカーソルが入り、`[表示文字](URL)` のソース表示に戻っていました。
  Ctrl/Cmd + クリックも今までどおり使えます。

### 修正

- **テーブルのセルに入力した文字が二重に入る問題。** セルを確定すると表が
  描画し直され、そのDOMの入れ替えで古い要素に `focusout` が発生して、もう一度
  書き込まれていました。`Enter`・`Tab`・行や列の追加のいずれでも、`oneXY` が
  `oneXYXY` になっていました。
- **`Tab` で移った先のセルに入力した文字が消える問題。** 移動の前に行う確定で
  ウィジェットが作り直され、セルの要素がすべて差し替わるため、移動先として
  掴んでいた要素は文書から外れたものになっていました。キー操作の受け口も古い
  表に残っていたため、移動先では `Enter`・`Esc`・続けての `Tab` も効きません
  でした。
- **ちょっとしたクリックで、描画されたブロックが生のソースに戻ってしまう問題。**
  テーブルの外周、行と行の間の線、すぐ上の余白などを触ったときや、単に連打した
  ときに、生の `|` 記法へ戻ってしまい、しかも何度も続けて起きることがありました。
  原因は3つありました。ほかの場所へ向かう途中でカーソルがブロックを通過した
  だけなのに「入った」と判定していたこと。素早い2回クリックでブラウザが単語を
  自動選択し、それがドラッグ選択に見えて処理が中断していたこと。そして判定に
  ブロック自身の枠だけを使っていたため、その周り（表の上30px・下7px）に
  どのブロックにも属さない帯が残っていたことです。なお、この保護はブロック
  （表・Mermaid など）だけに効かせています。同じ判定は見出しの `#` や
  `**太字**` の記号を出すかどうかにも使われているため、文書全体に効かせると、
  普通の行をクリックしても編集用のカーソルが入らなくなってしまいます。
- **ファイルへのリンクを開くと、OS の「指定されたファイルが見つかりません
  (0x2)」というダイアログが出る問題。** すべてのリンクを `Uri.parse` で
  そのまま OS に渡していました。これはスキーム付きのリンクにしか正しくありません。
  `./notes.md`、`../img/a.png`、あるいは単に `notes.md` のような相対リンクは
  Markdown ではごく普通ですが、スキームのない URI になり、何も基準にせず
  解決されていました。相対リンクはその文書自身のフォルダを基準に解決し、
  エディタで開くようにしました。`#見出し` の部分は切り離し、`%20` などの
  エスケープも元に戻します。リンク先が見つからない場合は、OS のエラーではなく
  パスを添えたメッセージを表示します。
- **Mermaid の図で、リセット（`↺`）を押しても最初の大きさに戻らない問題。**
  倍率は 1 に戻していましたが、原寸大モードのままでした。原寸大の1倍は図の
  本来の幅なので、拡大した状態から押すと途中の大きさで止まり、最初の縮小表示
  よりも大きいままでした。最後まで戻るようにしました。
- **表のセルの中身が少し複雑になると、他の Markdown ビューアと表示が変わる問題。**
  セルの中身は CodeMirror の外側で描画するため、パーサではなく手書きの正規表現で
  描いていました。そのため装飾が1つだけの単純な場合を超えると崩れていました。
  `***太字斜体***` はアスタリスクが残り、`**a *b* c**` や `**2 * 3**` は表示が
  壊れ、`_アンダースコア_` の強調と画像はそもそも認識されず、掛け算の意味で
  書いた `*` が斜体になり、バッククォート2個以上のコードは分断され、タイトル
  付きリンクは生のまま、太字の中のリンクはリンクになりませんでした。セルの中身も
  文書本体と同じパーサに通すようにしたので、GFM の規則どおりに表示されます。
  バックスラッシュのエスケープ、`<` や `&`、自動リンク、`<br>` にも対応しました。
  それ以外の生の HTML は、埋め込まずに文字としてそのまま表示します。
- **列揃え（`|:--|:-:|--:|`）が効いていなかった問題。** すべての列が左揃えで
  表示されていました。
- **セルの数が足りない行・多すぎる行で、表がガタついていた問題。** GFM では
  区切り行が列数を決めます。足りない行は空のセルで補い、多すぎる分は捨てるように
  したので、表の形が揃います。

## [0.0.10] — 2026-08-27

### 修正

- **カーソルが違う行に着地する問題と、スクロールのぐらつき。** 表・Mermaid 図・
  フロントマターの余白が CSS の `margin` で指定されていました。`margin` は
  CodeMirror が高さを測る範囲の外側にあるため、ブロック1個につき 14px が
  内部の高さ計算から抜け落ちていました。しかもこのズレは文書の下に行くほど
  積み上がります。ファイル冒頭では1行、下の方では3行ずれていました。表や図が
  多い文書ほど影響が大きい状態でした。余白を測定範囲の内側に移したので、
  どのスクロール位置でも表示と位置が一致します。
- **Mermaid 図の描画が終わった瞬間に画面が跳ねる問題。** 図は非同期で描画され
  ますが、1行分のプレースホルダーから実際の高さに変わったことをエディタに
  伝えていませんでした。画像の読み込み完了時、図の表示モード切替時も同様です。
- **段落の末尾で Enter を押すとカーソルが1行分離れた場所に飛び**、入力を始めると
  戻ってくる問題。段落が直後の空行を含むようにしたので、余白が区切り行の上では
  なく下に来ます。見た目は変わりません。

### 追加

- Claude Code の読み取り専用の出力タブを、**「エディターを選択して再度開く」**
  からライブプレビューで開けるようになりました。これらは拡張子を持たない
  メモリ上の仮想ファイルなので、`*.md` の関連付けでは対象にできませんでした。

## [0.0.9] — 2026-07-28

### 修正

- 箇条書きの直下に空行なしで置いた表が、描画されず生のテキストのままだった問題。

## [0.0.6] – [0.0.8] — 2026-07-23

### 変更

- Marketplace 用のスクリーンショットを、エディタ部分だけが写るよう切り直し。

## [0.0.5] — 2026-07-23

### 追加

- **太字・斜体のキーボードショートカット**（`Ctrl+B` / `Ctrl+I`）。
- **画像の貼り付けとドラッグ＆ドロップ。** 文書の隣の `assets/` フォルダに保存し、
  相対パスで挿入します。
- サイドバーの **アウトライン表示**（見出し一覧）。

### 修正

- カーソルが表の中にある状態で画像を貼ると、表が壊れる問題。

## [0.0.4] — 2026-07-16

### 変更

- Marketplace の掲載内容の調整。

## [0.0.3] — 2026-07-13

### 追加

- **Mermaid の「自動縮小 / 原寸大」表示切り替え。** 原寸大表示ではドラッグで移動、
  Ctrl+ホイールで拡大縮小ができます。
- 編集の補助機能: 強調記号とコードフェンスの自動対応付け、見出し記号の後の
  自動スペース。

### 修正

- フロントマターがあると、文書内の他の装飾がすべて描画されなくなる問題。
- 箇条書きと引用の縦の余白が二重になる問題。
- 他の拡張機能（AI チャットのファイルリンクなど）から開いた Markdown が、
  ライブプレビューに切り替わらず通常のテキストエディタのままだった問題。

### 変更

- 新規インストール時に、VS Code 標準のサンプルテーマが適用されるようになりました。

## [0.0.2] — 2026-07-09

### 修正

- CSS テーマの読み込み、ライブプレビューの自動再オープン、Mermaid の描画。

## [0.0.1] — 2026-07-08

- Marketplace への初回公開。
