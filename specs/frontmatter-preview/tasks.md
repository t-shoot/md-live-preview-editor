# フロントマター表示 タスク分解

`requirements.md`(承認済み)・`design.md`(承認済み)を入力とする。上から順に実装し、
タスクごとに差分を確認する。

- [x] **T1. 依存追加**
  `npm install yaml` を実行し、`package.json`/`package-lock.json` に反映する。
  (design.md §3)

- [x] **T2. `src/webview-editor/frontmatterWidget.ts` 新規作成 — 検出ロジック**
  `FrontmatterRange` 型と `detectFrontmatter(state: EditorState): FrontmatterRange | null` を実装。
  1行目が厳密に `---`、以降で厳密に `---` のみの行を探す行ベース走査。
  (design.md §2 / REQ-1, REQ-2)

- [x] **T3. 同ファイル — `FrontmatterWidget`(成功時)**
  `yaml` の `parse()` で得たエントリ配列から `<table class="mlp-frontmatter">` を構築する
  `WidgetType`。`mousedown` でカーソル移動 + `ignoreEvent(): false`(`TableWidget` と同型)。
  値のフォーマットは design.md §6 の規則(スカラー/配列/マップ)に従う。
  (design.md §5, §6 / REQ-3, REQ-6, REQ-8 の器)

- [x] **T4. 同ファイル — `FrontmatterEmptyWidget`(エントリ0件時)**
  `get estimatedHeight(): number { return 0; }` を実装し、`toDOM()` は空の
  `document.createElement('span')` を返す(`HiddenMarkerWidget` と同型)。
  (design.md §2 末尾 / REQ-4)

- [x] **T5. 同ファイル — `FrontmatterErrorWidget`(解析失敗時)**
  `<div class="mlp-frontmatter-error" role="alert">` にエラーメッセージを表示。
  (design.md §5 / REQ-5)

- [x] **T6. `src/webview-editor/blockDecorations.ts` 修正 — 組み込みとオーバーラップガード**
  `buildBlockDecorations()` 冒頭で `detectFrontmatter(state)` を呼び、
  `tree.iterate()` の `enter` 先頭(`FencedCode`/`Table` の判定より前)に
  フロントマター範囲と重なるノードを弾く早期リターンを追加。
  解析成功(entries>0) / 解析成功(entries=0) / 解析失敗 の3分岐でウィジェットを出し分け、
  `Decoration.replace({ widget, block: true })` で置換する。
  (design.md §4 / REQ-1〜REQ-5, REQ-7)

- [x] **T7. `src/webview-editor/livePreviewPlugin.ts` 修正 — 整合性ガード(任意最適化)**
  `Paragraph` 等の各 case 先頭で、フロントマター範囲内の行に対しては行クラス付与を
  スキップする一文を追加(必須ではないが無駄な装飾計算を避ける)。
  (design.md §4 末尾)

- [x] **T8. `media/webview-editor-theme.css` 修正 — スタイル追加**
  `.mlp-frontmatter`, `.mlp-frontmatter th`, `.mlp-frontmatter td`, `.mlp-frontmatter-error` を、
  既存の `.mlp-checkbox` 等と同じ `var(--vscode-*, フォールバック)` 書式で追加。
  ユーザーの CSS テーマ機構(`cssAdapter.ts`)には含めない。
  (design.md §5 / REQ-8)

- [x] **T9. 動作確認**
  `npm run compile` に加え、実際の `livePreviewPlugin`/`blockDecorationsField`/`frontmatterWidget`
  を esbuild でブラウザ向けにバンドルし、実物の CodeMirror `EditorView` をPlaywrightのブラウザに
  マウントして AC-1〜AC-7 を自動チェック + スクリーンショットで確認した。全項目 PASS。

  検証中に **実装バグを1件発見・修正**(design.md にはなかった追加対応、T10として記録):
  文書を開いた直後、CodeMirror の選択位置は既定でオフセット0(＝1行目)になるが、フロントマターは
  定義上つねに1行目から始まるため、`cursorTouchesRange` が常に真になり、**開いた瞬間はテーブルが
  一切描画されない**(カーソルを動かすまで生の `---`/YAML テキストのまま)という REQ-3 違反が
  あった。

- [x] **T10. `src/webview-editor/main.ts` 修正 — 初期カーソル位置の補正(T9で発見、追加対応)**
  `createView`/`resetView` が使う初期 `EditorState` 構築を `initialStateFor()` に切り出し、
  文書がフロントマターで始まる場合のみ、初期選択位置をブロックの直後(閉じ `---` 行の**次の行**)
  に設定するよう修正。`fm.to` はブロックの範囲としては正しい値(閉じ `---` 行自身の末尾)だが、
  カーソル配置に使う場合はそのままだと「まだ同じ行」と判定されてしまうため、`fm.to + 1`
  (文書末を超えないようクランプ)を使う。修正後、Playwright上での再検証で AC-1〜AC-7 全て PASS
  したことを確認済み。
