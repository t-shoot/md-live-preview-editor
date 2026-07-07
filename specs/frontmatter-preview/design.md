# フロントマター表示 基本設計

`requirements.md` (承認済み) を入力とする。既存コードを実際に読んで確認した事実に基づく。

## 1. 全体方針

既存の GFM テーブル(`TableWidget`)・Mermaid図(`MermaidWidget`)は、いずれも
「CodeMirror の `syntaxTree` がその構文ノード([`Table`], `FencedCode`+`mermaid`)を
検出 → カーソルがその範囲に触れていなければ `blockDecorationsField`(StateField)が
`Decoration.replace({ widget, block: true })` で丸ごと差し替える」という共通パターンで
実装されている([blockDecorations.ts](../../src/webview-editor/blockDecorations.ts))。

フロントマターもこの**既存パターンに乗せる**。ただし1点、アーキテクチャ上の重要な違いがある:

> **`@lezer/markdown` にはフロントマターというノード種別が存在しない。** `---`〜`---` は
> 通常の Markdown として解析される(先頭の `---` は文脈次第で `HorizontalRule` 等になり得る)。
> そのため Table/Mermaid のように `tree.iterate()` の中で `node.name === 'Table'` のように
> 判定することはできず、**行ベースの独自スキャン**(構文木を使わない、`state.doc` に対する
> 直接の位置判定)でフロントマター範囲を検出する必要がある。

## 2. 新規ファイル

`src/webview-editor/frontmatterWidget.ts`(`mermaidWidget.ts` と対の構成)

```ts
export interface FrontmatterRange { from: number; to: number; yamlText: string }

// state.doc の1行目が厳密に "---" で始まり、以降に厳密に "---" のみの行があれば
// その範囲を返す。純粋に行位置だけを見る(syntaxTree に依存しない)。
export function detectFrontmatter(state: EditorState): FrontmatterRange | null

export class FrontmatterWidget extends WidgetType   // 解析成功・エントリ1件以上
export class FrontmatterEmptyWidget extends WidgetType // 解析成功・エントリ0件(高さ0)
export class FrontmatterErrorWidget extends WidgetType // 解析失敗
```

`detectFrontmatter` の判定(REQ-1, REQ-2 に対応):
1. `state.doc.lines >= 2` かつ `state.doc.line(1).text === '---'`
2. 2行目以降を走査し、`text === '---'` である最初の行 `n` を探す
3. 見つかれば `{ from: line(1).from, to: line(n).to, yamlText: 2〜(n-1)行目の結合テキスト }`
4. 見つからなければ `null`(先頭が `---` でも閉じが無ければフロントマターとして扱わない)

この判定はドキュメント先頭固定(1行目)なので、文書中盤に偶然 `---`〜`---` が現れても
対象外になる(REQ-2)。なお「本文中の水平線がたまたま先頭行かつ後続にも `---` がある」場合に
誤ってフロントマター扱いされる可能性は残るが、これは Jekyll/Hugo/VS Code 純正プレビュー含め
フロントマター記法一般が共通して持つ既知のトレードオフであり、本設計でも同様に許容する。

`FrontmatterEmptyWidget`(REQ-4、エントリ0件時)は、[livePreviewPlugin.ts](../../src/webview-editor/livePreviewPlugin.ts)
の `HiddenMarkerWidget` と同じ理由で `get estimatedHeight(): number { return 0; }` を明示的に
実装し、`toDOM()` は中身のない `document.createElement('span')` を返す。CodeMirror の行高さ
推定ロジックが誤って計測対象に選ばないよう、同ファイルの `HiddenMarkerWidget` のコメントに
ある通りの注意が必要(素の空 `<div>` だとテキストノードのみの行と誤認されるリスクがある)。

## 3. YAML解析ライブラリ(新規依存)

現状 `package.json` に YAML パーサーは存在しない(要新規追加。CLAUDE.mdの依存追加ルールに従い
ここに理由を明記する)。

**採用: `yaml`(npm パッケージ名 `yaml`, eemeli/yaml)**

理由:
- 依存ゼロ・TypeScript型を同梱・現在もメンテナンスが活発
- `YAMLParseError` が発生位置(行・列)を持つため、REQ-5 のエラー内容表示に十分な情報が
  そのまま使える
- 既存依存(`@codemirror/*`, `@lezer/*`, `@shikijs/*`)と同様、スコープ無しの単一目的パッケージで
  プロジェクトの依存の粒度と揃う

代替案として `js-yaml` も検討したが、型同梱状況・エラー情報の粒度で `yaml` を優先する。
最終決定は実装タスクの中で `npm install yaml` を実行し `package.json` に反映する。

使用箇所: `frontmatterWidget.ts` 内で `import { parse } from 'yaml'` し、`try/catch` で
`FrontmatterWidget`(成功)と `FrontmatterErrorWidget`(失敗)を出し分ける。

## 4. `blockDecorations.ts` への組み込み

`buildBlockDecorations()` の先頭(`tree.iterate()` の前)で一度だけ `detectFrontmatter(state)`
を呼ぶ。Table/Mermaid と同じガード条件を適用する:

**重要: `Table`/`FencedCode` ノードとの範囲重複を防ぐガードが必須。** YAML本文が
`key: | a | b |` のような行を含む場合、`@lezer/markdown` がフロントマター範囲の内側に
`Table` や `FencedCode` ノードを解析してしまう可能性がある。これを放置すると、同一
`DecorationSet` の中に範囲が重なる2つの `block: true` 置換デコレーション(フロントマター用と
Table/Mermaid用)が入り、CodeMirror の RangeSet 構築(「sorted and non-overlapping」制約)で
例外になる。

現行の `tree.iterate({ enter: (node) => { if (node.name === 'FencedCode') {…} if (node.name
=== 'Table') {…} } })` という構造([blockDecorations.ts](../../src/webview-editor/blockDecorations.ts)
そのまま)に対し、**`enter` コールバック本体の一番先頭、`if (node.name === 'FencedCode')` よりも
前**に、フロントマター範囲と重なるノードを無条件でスキップする早期リターンを追加する
(`if (node.name === 'Table')` 側だけに付けるのではなく、両方の `if` より前に1回だけ置く):

```ts
tree.iterate({
	enter: (node) => {
		if (fm && node.from < fm.to && node.to > fm.from) return false; // ← ここが最優先、両方の if より前
		if (node.name === 'FencedCode') { /* 既存のまま */ }
		if (node.name === 'Table') { /* 既存のまま */ }
	},
});
```

これにより、フロントマター用の置換範囲(`fm.from`〜`fm.to`、常に文書位置0から閉じ `---` 行末
までの行境界ちょうど)の内側にある `FencedCode`/`Table` ノードは、`enter` に入った瞬間に
(`node.name` の判定に到達する前に)無条件で弾かれ、他のブロックデコレーションと範囲が
重なることはなくなる。

```ts
const fm = detectFrontmatter(state);
if (fm && !cursorTouchesRange(state, fm.from, fm.to)) {
	let widget: WidgetType;
	try {
		const data = YAML.parse(fm.yamlText) ?? {};
		const entries = Object.entries(data);
		widget = entries.length === 0
			? new FrontmatterEmptyWidget()               // REQ-4: 何も描画しない
			: new FrontmatterWidget(entries);             // REQ-3: テーブル表示
	} catch (err) {
		widget = new FrontmatterErrorWidget(String(err)); // REQ-5: エラー表示
	}
	decorations.push(Decoration.replace({ widget, block: true }).range(fm.from, fm.to));
}
```

`cursorTouchesRange` は行番号だけを見る純粋関数(構文木非依存、[cmUtils.ts](../../src/webview-editor/cmUtils.ts))
なので、フロントマター範囲にもそのまま使える。これにより **REQ-7(カーソルを合わせると編集可能な
生テキストに戻る)は Table/Mermaid と全く同じ仕組みで自動的に満たされ、新規の相互作用コードは
不要**(カーソルがその行に乗った瞬間、次回の `update()` で `buildBlockDecorations` が再実行され、
`cursorTouchesRange` が真になり widget が外れて生の `---`/YAML テキストが表示される)。

`livePreviewPlugin.ts` 側(インライン装飾)は、フロントマター範囲を素通りしても実害はない
(見出し/水平線等のマークが多少付くだけで、`blockDecorationsField` 側の `block: true` 置換が
その範囲を丸ごと覆うため画面には出ない — Table/Mermaid でも同様に、`livePreviewPlugin.ts` 側は
`return false` で明示的にスキップしているが、これは主に無駄な装飾計算を避けるための最適化であり、
必須ではない)。ただし整合性のため、`FencedCode`/`Table` と同様に `Paragraph` 等のケース先頭で
「この行はフロントマター範囲内か」を早期リターンする一文を追加し、無駄な行クラス付与を避ける。

## 5. ウィジェットの DOM 構造とスタイル

Table ウィジェット(`mlp-table`)に倣い、ユーザーの CSS テーマ機構(`cssAdapter.ts`)の対象には
**含めない**。VS Code 純正プレビューも `table.frontmatter` を通常の `table` とは別に固定スタイルで
描画しており(`--vscode-widget-border` 等の VS Code 変数を直接使用)、本アプリもこれに倣い
`media/webview-editor-theme.css`(アプリ自身の基盤UI、ユーザーが差し替えるテーマの対象外)に
固定スタイルとして追加する。

```html
<table class="mlp-frontmatter">
  <tbody>
    <tr><th>title</th><td>サンプル</td></tr>
    <tr><th>tags</th><td>a, b, c</td></tr>
  </tbody>
</table>
```

エラー時:
```html
<div class="mlp-frontmatter-error" role="alert">
  <strong>フロントマターの解析に失敗しました</strong>
  <pre>(YAMLParseError のメッセージ)</pre>
</div>
```

追加 CSS クラス(`media/webview-editor-theme.css` に追記。既存の `.mlp-checkbox` 等と同じ、
`var(--vscode-*, フォールバック値)` の書式に揃える):
`.mlp-frontmatter`, `.mlp-frontmatter th`, `.mlp-frontmatter td`, `.mlp-frontmatter-error`

`TableWidget` と同じく `mousedown` でカーソルをその位置へ移動させ(`view.posAtDOM` +
`view.dispatch({selection:{anchor:pos}})` + `view.focus()`)、`ignoreEvent()` は `false` を返す
(CodeMirror にもイベントを見せ、以後は `cursorTouchesRange` が担う)。

## 6. 値のフォーマット規則(REQ-6)

セルの値 `value: unknown` を以下の優先順で文字列化する(再帰は1段のみ、過剰な入れ子表現は作らない):

- `string | number | boolean | null` → そのままテキスト化(`null` は空文字)
- 配列(要素が全てスカラー) → `, ` 区切りで結合したテキスト
- 配列(スカラー以外を含む)、またはマップ(オブジェクト) → `JSON.stringify(value, null, 2)` を
  `<pre>` としてセル内に表示(可読性より確実性を優先。将来的に凝った表現が必要になれば別途拡張)

## 7. 要件トレーサビリティ

| 要件 | 設計での対応 |
|---|---|
| REQ-1, REQ-2 | `detectFrontmatter`(1行目固定・行ベース走査) |
| REQ-3 | `FrontmatterWidget`(`yaml` で解析 → `<table class="mlp-frontmatter">`) |
| REQ-4 | `entries.length === 0` 時に `FrontmatterEmptyWidget`(高さ0、何も描画しない) |
| REQ-5 | `try/catch` + `FrontmatterErrorWidget` |
| REQ-6 | §6 の値フォーマット規則 |
| REQ-7 | 既存の `cursorTouchesRange` ガードをそのまま再利用(新規相互作用コード不要) |
| REQ-8 | `media/webview-editor-theme.css` に `var(--vscode-*)` ベースで固定スタイル定義 |

## 8. 未確定 → 本設計での決定事項まとめ

- YAML ライブラリ: `yaml` パッケージを新規追加(§3)
- 表示方式: `blockDecorationsField` への組み込み(Table/Mermaid と同一パターン)(§4)
- REQ-7 の相互作用: 新規実装不要、既存 `cursorTouchesRange` ガードの再利用(§4, §5)
