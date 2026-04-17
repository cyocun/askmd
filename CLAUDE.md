# Contributor / AI Notes

## プロジェクトの目的と設計思想

**askmd は「`.md` だけを対象にした、サクサク回遊できるビューア + 選択範囲を AI に質問できるツール」。**

既存の Obsidian / Typora / MarkView / markdown-explorer / Ferrite ではなく、あえて作る理由：

- Obsidian / Typora は重くノート管理寄り。**「読むだけ」「大量の md を回遊するだけ」の用途に対してオーバーキル**
- VS Code の Markdown Preview で読めるが、コード以外のノイズが多く「md だけを眺める」専用のUIではない
- markdown-explorer はコンセプト一致だが 2018 年で開発停止。Electron で古い
- Ferrite は Rust 製軽量だがエディタが主役。macOS experimental。md 以外も扱う
- **「md ビューア + 選択範囲を AI に質問」** という組み合わせは既存に空席（MDChat は CLI 特化で GUI ではない）

つまり、**「溜まった md を、静かに速く読みながら、気になった箇所をその場で AI に聞ける GUI」** が存在しない。これが askmd の存在意義。

## ターゲットユーザー

- md ファイルが溜まっている人（場所は問わない — docs/ でも ~/notes でもデスクトップでも）
- 読みながら「ここどういう意味?」「これ要約して」を AI に即投げたい人
- Markdown でドキュメントを共有しているチーム — デザイナーも PM もエンジニアも
- エディタは別のもの（VS Code 等）で書いている
- AI CLI がなくても軽量 md ビューアとして使える

## 基本方針

- **サクサク最優先**: 起動速度、ファイル切り替え速度、キーボード操作で完結すること
- **キーボードとマウスの両立**: キーボード派の体験を維持しつつ、全機能にマウスでも到達可能に。`↑↓` / `Enter` / `@` / `Cmd+P` / `Cmd+L` などのショートカットは常備
- **md に絞る**: JSON/YAML/TOML 等は対象外。ツリーにも出さない。隠しディレクトリ (`.git`, `node_modules`, `.obsidian` 等) もスキップ
- **AI 連携は既存 CLI 流用**: API キー管理はしない。`claude -p` / `gh copilot` / `chatgpt` をサブプロセスで呼ぶ。CLI がなくてもビューア単体で動作
- **対象ターゲット**: A=デザイナー/PM (Markdown 書ける、ターミナルは触らない)、B=ライター/リサーチャー (読み主体)。エンジニアは副次対象だが体験を犠牲にしない
- **表面はシンプル、深部に高度機能 (Progressive Disclosure)**: 非エンジニアは見えている範囲で完結、エンジニアは掘れば全部触れる。機能追加時はまず「前面に出すか奥に隠すか」を判断する

## AI への質問の仕組み

- デフォルトは **インライン**: 選択 → `Cmd+L` → 選択中のプロバイダの CLI を子プロセス実行 → 右ペイン下部に回答描画
- 対応プロバイダ: Claude (`claude -p`、構造化ストリーミング)、Copilot (`gh copilot explain`)、ChatGPT (`chatgpt`、stdin 入力)
- プロバイダは起動時に `which` で自動検出。複数あればメニューから切替可能。ゼロならビューアモード
- 将来: ターミナルで開くモード (`osascript` 経由で Terminal/iTerm に `claude` を流す)、Claude Desktop 連携 (現状 deep link でプロンプトプリフィル不可、将来対応)

## 編集モデル (2026-04-17 時点の考え方)

askmd は「読むが主、書くは補助」。書く体験を過剰に作り込むと複雑さが
指数的に増えるので、**必要最小限の 2 パス**だけに絞る。どちらも
「ファイル本体は Markdown のまま、装飾は decoration のみ」を絶対条件にして
ラウンドトリップ事故ゼロを維持する。

### パス 1: 全体ソース編集 (`⌘E`)
- `reading ↔ source` の 2 段トグル。ファイル全体を CM6 で開く
- CM6 の `HighlightStyle` で「記号は見えたまま、見出し/強調/斜体/取消線/リンク/インラインコードが装飾される」= Obsidian の Source Mode 相当
- `ViewPlugin` の line decoration でコードブロック背景・blockquote 左 border・table 背景
- Table 内は Tab/Shift-Tab でセル移動、最終セル Tab で新行追加、table 内 Enter で直後に空行を挿入 (Advanced Tables 風)
- 保存は `⌘S`。fs-changed で読むモードが自動再描画

### パス 2: 選択範囲だけの mini editor (選択フロートバー → 鉛筆「編集」)
- 本文を選択 → 選択フロートバーの **鉛筆アイコン** → 小さな CM6 popover が浮かぶ
- 選択プレーンテキストを Markdown body の中で `indexOf` 検索 → 見つかった offset range だけを mini editor に投入
- 検索で見つからない (記法をまたぐ選択 = DOM selection.toString() が body 原文と不一致) 時は、**anchor block (`data-lines` 持ち) 全体にフォールバック**して block 丸ごと編集可能にする
- `⌘S` で body の該当 offset を置換、frontmatter は split/restore で常に保持

### WYSIWYG を入れない理由
一度 Ixora (Typora 流 = カーソル行だけ記号が見える) と、テーブル用の block widget を実装したが却下:
- Typora 流のパタパタ切替が実運用で気が散る
- テーブル widget は「カーソルが入ると切り替わる」挙動が破綻的に突然で UX を損なう
- `==mark==` / admonition / Mermaid / KaTeX 等の装飾は Ixora では扱えず、自作の検証コストが大きい

Milkdown / TipTap / 素の contenteditable も検討したが同じ理由で採用せず:
- ProseMirror 系 (Milkdown/TipTap) は `==mark==` / admonition の自前プラグイン + テーマ整合コスト
- 素の contenteditable は WebKit の IME / Enter / paste 挙動の地雷が大きく、日本語話者の入力体験を壊すリスク

「記号は見えたままで装飾がリッチ」を CM6 標準機能だけで組み上げるのが、
実装量・round-trip 安全性・複雑度のバランスで最良と判断した。

### 「table 編集が辛い」など不便が出た時の打ち手
段階的に拡張する方針。先回りしない:
1. まずは数週間使って実際のストレスを計測する
2. 足りなければ **読むモードの table に contenteditable を差し込む** (地雷面積が table 内だけに限定される最小介入)
3. それでも足りなければ **Milkdown を再検討**。`==mark==` / admonition の自前プラグインを書く覚悟ができてから全面移行を検討
4. `app.ts` の過剰分割・新フレーム導入など複雑化の方向には原則行かない

## コード規約

- フロントエンドは **Vite** でバンドル。TypeScript ソースは `frontend/ts/`、CSS は `frontend/styles/`
- ライブラリは npm パッケージとして管理（`import MarkdownIt from 'markdown-it'` 形式）
- Tauri API は `@tauri-apps/api` から import（`import { invoke } from '@tauri-apps/api/core'`）
- DOM は `innerHTML` を使わず、`createEl()` / `svgEl()` などの DOM API ヘルパー経由で構築する
- アイコンは Tabler Icons (24x24 viewBox、stroke-width:2)。`frontend/icons/` に SVG を追加し `frontend/ts/icons.ts` で参照
- 日本語コメント可。ただしコードで語れる内容は書かない — コメントは「なぜ」だけに絞る

## レイアウト規約 (csm から継承)

- メインレイアウトは CSS Grid
- Grid 子要素の overflow は `min-height: 0` を明示しないと効かない

## バックエンド規約

- Tauri コマンドは `src-tauri/src/commands/{domain}.rs` にドメインごとに分割
- プラグイン機能は Rust 側でラップした `#[tauri::command]` を追加し、JS からは `invoke('...')` で呼び出す

## 実装済み機能

### Phase 1 (MVP)
- ディレクトリを開く (ダイアログ + CLI 引数 `askmd ~/myrepo` + フォルダ D&D)
- `.md` だけのツリー (隠しディレクトリ・空ディレクトリは非表示)
- レンダリング: markdown-it + highlight.js + DOMPurify
- キーボード: `↑↓` / `j` `k` 移動、`Enter` 開く、`@` 絞り込み、`Cmd+P` クイックスイッチ
- ファイル変更監視 (`notify` crate)
- 相対リンクで `.md` 内部遷移、画像は同ディレクトリ基準
- フロントマター抽出 → 上部ヘッダーUIに (タイトル/日付/タグ)
- 選択範囲 → `Cmd+L` → AI ストリーミング回答 → 右ペイン下部に描画
- ゴミ箱削除 + `Cmd+Z` Undo
- 見出しアウトライン (→/← でファイル⇔アウトラインモード切替)

### Phase 1.5 (拡張)
- テーマシステム (GitHub Light/Dark, Solarized Light/Dark)
- Mermaid ダイアグラム + KaTeX 数式レンダリング
- AI プロバイダ切替 (Claude / Copilot / ChatGPT)
- LLM なしビューアモード (AI 不在時はプロバイダ非表示)
- 全文横断検索 (`Cmd+F`、tantivy ベースの高速全文検索)
- Claude 回答ストリーミング
- ツリーに frontmatter title 表示
- IME composing 対応
- 翻訳機能 (`Cmd+Shift+T`、Google Translate 非公式 API、API キー不要)
- 最近開いたディレクトリの永続化 (起動画面に最大 5 件表示)
- `.md` ファイルアソシエーション (Finder からダブルクリックで開く)
- 自動アップデータ (`tauri-plugin-updater`、起動 5 秒後 + 6 時間周期)
- GitHub Actions リリースワークフロー (`v*` タグで macOS .dmg ビルド)

### Phase 2
- Vite バンドラ導入 (vendor/ 全廃止、npm パッケージ化、`@tauri-apps/api` 正規 import)
- コードブロックのコピーボタン (ホバーで Copy ボタン表示)
- 読書位置の記憶 (localStorage に永続化、ファイル再オープン時に復元)
- AI にファイル全体をコンテキスト (選択なし Cmd+L でファイル全体について質問可能)
- 簡易編集 (`Cmd+E` でレンダリング ↔ CodeMirror 6 ソース編集トグル、`Cmd+S` 保存、`Escape` キャンセル)
- 変更差分ハイライト (git ベース、直近コミットからの変更行を文字単位で強調・インライン表示・削除行表示、ツリーの変更ファイルバッジ)

### Phase 3 (非エンジニア対応 + 回遊性 + 軽い編集支援)
- 文言の Mac ネイティブ化 — エラー/トーストの「失敗」系を「次にできること」に書き換え
- 選択フロートバー — 本文選択で浮かぶ `聞く / 訳す / 要約 / コピー`。`聞く` と `要約` は AI、`訳す` は Google Translate 非公式 API をそのまま呼ぶ軽量ポップオーバー
- 右下の常時「このメモについて聞く」ボタン (選択なし時のみ)、編集モード中は非表示
- Ask パネル: よく使うテンプレートチップ (要約 / 専門用語 / アクション抽出 / やさしく言い換え)、最初の送信で折り畳み
- Ask パネル: 会話履歴の `localStorage` 永続化 (`askmd-ask-history:{path}`)、再オープンで過去 Q/A を復元描画し `sessionId` で継続。「ここから捨てる」で履歴とセッションを破棄
- ツリー右クリックメニュー (ファイル=開く/プレビュー/Finder/パス・名前コピー/複製/名前変更/ゴミ箱、フォルダ=新しいメモ/Finder/パスコピー)
- 名前変更用の自前プロンプトモーダル (`prompt-modal.ts`)、拡張子を残して stem だけ選択
- Quick Look 風プレビュー (Space) — ツリー選択中のファイルをオーバーレイで軽量レンダ、Space/Esc/外側クリックで閉じる
- 最近更新 (`tbRecent`) — Rust 側 `get_recent_files` が mtime 降順で返す。パレット風オーバーレイで相対時刻表示
- 画像 D&D (編集モード) — `tauri://drag-drop` から画像拡張子だけを振り分け、`import_asset` で同フォルダにコピー + `editor.insertAtCursor` で Markdown 挿入
- ツリー内 md ドラッグ移動 — ファイル行を `draggable`、ディレクトリ行がドロップ先。`move_file` コマンドで `fs::rename`
- 新コマンド: `rename_file` / `duplicate_file` / `move_file` / `create_new_markdown` / `import_asset` / `get_recent_files`
- 編集モードを「リッチソース」に (`⌘E` で reading ↔ source の 2 段) — CM6 の `HighlightStyle` で見出し/強調/斜体/取消線/リンク/インラインコードを装飾、`ViewPlugin` で行単位装飾 (`cm-md-codeblock` 背景・`cm-md-quote` 左 border・`cm-md-table` 薄背景)。記号は隠さない方針なので round-trip 事故ゼロ
- 編集モード: Table 内の Tab/Shift-Tab/Enter ナビ (Advanced Tables 風、`editor-table-nav.ts`) — セル間移動、最終セル Tab で行追加、table 内 Enter で直下に空行

## Phase 3 残 / Phase 4 候補

### 未着手 (意図的に後回し)
- **初回起動オンボーディング** (3 画面: フォルダ選択 / AI は任意 / 主要操作チートシート)
- **外部 (Finder/Slack) へのドラッグ書き出し** (Tauri のネイティブ drag-out サポート状況要調査)
- 「未読」入口 (既読管理のためのメタデータが別途必要)
- Ask 継続会話の「ここまでを送る」操作 (現状は Claude CLI の sessionId 任せ)

### 編集モードの方針決定 (WYSIWYG は採用しない)
一度 Ixora ベースの WYSIWYG (記号を隠す Typora 流) を実装したが却下した。理由:
- 「読む主体、書くは補助」の基本方針に照らすと、書く側に凝るほど複雑度が跳ね上がる
- Typora 流の「カーソル行だけ記号が見える」挙動はパタパタして実際の編集で気が散る
- table / Mermaid / KaTeX / admonition / `==mark==` の装飾は Ixora では扱えず、自作する場合は round-trip 事故の検証コストが大きい

Milkdown / TipTap / 素の contenteditable も検討したが同じ理由で不採用:
- ProseMirror 系は admonition / `==mark==` の自前プラグインが必要 + UI 整合コスト
- 素の contenteditable は WebKit の IME / Enter / paste 挙動の地雷が大きく、非エンジニアの日本語入力体験を壊すリスク

採用した線は **CM6 + HighlightStyle + 行装飾 + Table ナビ**。「記号は見えたままでスタイルがリッチに乗る」= Obsidian の Source Mode 相当。round-trip は数学的に保証 (テキストを触らない)。table の `|` 区切りは「読むに戻って確認 → ソースで編集」のサイクルで許容する。

次に「table 編集が辛い」「読むモードからちょい直したい」となった時の段階的な打ち手 (2026-04-17 時点で未着手の検討メモ):
1. **選択範囲インライン編集**: 読むモードで任意のブロックを選択 → 「編集」ボタン → その block だけ contenteditable or CM6 mini editor を開く → 保存で元 md の `data-lines` 範囲を書き換え。既存の `data-lines` 属性がそのまま活用できる。block ごとの HTML→Markdown 変換が要る (Turndown + 自前ルール or block 種別ごとの逆変換)
2. **読むモードの table だけ contenteditable**: 地雷面積を table 内に限定 (1 より簡易、ただし table 以外はソース編集に戻る)
3. 上記で足りない場合のみ **Milkdown 再検討**。table 1 箇所のために全面移行はコスト過大なので、admonition / `==mark==` 自前プラグインの実装コストを払う覚悟ができてから

### 後回し / 検討中
- macOS コード署名 / Notarization
- Homebrew Cask (`brew install --cask cyocun/tap/askmd`、ワークフロー・スクリプトは実装済み)
- ターミナル連携モード (`Cmd+Shift+L` → iTerm/Terminal で `claude` 対話)
- Claude Desktop 連携 (deep link でのプロンプトプリフィル API が来たら)
- ウィンドウタブ (`Cmd+T`、複数フォルダ同時オープン)
- 共有メニュー (macOS 共有シート: メール、メモ、AirDrop)
- 分割表示 (side-by-side 2 ファイル比較)
- スクロールバーのスタイリング (細い常時表示 or ホバーで出現)
- ドラッグでサイドバー幅調整
- `app.ts` (~1700 行) の `state.ts` / `keymap.ts` 分割 — Phase 3 で selection-bar / translate-popover / context-menu / prompt-modal / ask-history は分離済
