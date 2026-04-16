# Contributor / AI Notes

## プロジェクトの目的と設計思想

**askmd は「`.md` だけを対象にした、サクサク回遊できるビューア + 選択範囲を Claude に質問できるツール」。**

既存の Obsidian / Typora / MarkView / markdown-explorer / Ferrite ではなく、あえて作る理由：

- Obsidian / Typora は重くノート管理寄り。**「読むだけ」「大量の md を回遊するだけ」の用途に対してオーバーキル**
- VS Code の Markdown Preview で読めるが、コード以外のノイズが多く「md だけを眺める」専用のUIではない
- markdown-explorer はコンセプト一致だが 2018 年で開発停止。Electron で古い
- Ferrite は Rust 製軽量だがエディタが主役。macOS experimental。md 以外も扱う
- **「md ビューア + 選択範囲を Claude に質問」** という組み合わせは既存に空席（MDChat は CLI 特化で GUI ではない）

つまり、**「Claude Code ユーザーが書き溜めた docs を、静かに速く読みながら、気になった箇所をその場で聞ける GUI」** が存在しない。これが askmd の存在意義。

## ターゲットユーザー

- Claude Code を日常的に使っている
- docs/ 配下に md を溜め込んでいる（数十〜数百規模）
- 読みながら「ここどういう意味?」「これ要約して」を即投げたい
- エディタは別のもの（VS Code 等）で書いている

## 基本方針

- **サクサク最優先**: 起動速度、ファイル切り替え速度、キーボード操作で完結すること
- **キーボードファースト**: マウスなしで回遊できる。`↑↓` で移動、`Enter` で開く、`/` でインクリメンタル絞り込み、`Cmd+P` でクイックスイッチ、`Cmd+L` で選択範囲を質問
- **md に絞る**: JSON/YAML/TOML 等は対象外。ツリーにも出さない。隠しディレクトリ (`.git`, `node_modules`, `.obsidian` 等) もスキップ
- **Claude 連携は CLI 流用**: Anthropic API キー管理はしない。`claude -p "..."` をサブプロセスで呼ぶ前提。API キー管理の面倒を回避しつつ、ユーザーの既存サブスクを流用

## Claude への質問の仕組み

- デフォルトは **インライン**: 選択 → `Cmd+L` → `claude -p "質問"` を子プロセス実行 → 右ペイン下部に回答描画
- 将来: ターミナルで開くモード (`osascript` 経由で Terminal/iTerm に `claude` を流す)、Claude Desktop 連携 (現状 deep link でプロンプトプリフィル不可、将来対応)

## コード規約 (csm から継承)

- フロントエンドはバンドラを入れず `tsc` のみでコンパイル (`npm run build:frontend`)。ES Modules でファイル分割、`import ... from './foo.js'` 形式
- DOM は `innerHTML` を使わず、`createEl()` / `svgEl()` などの DOM API ヘルパー経由で構築する
- アイコンは Tabler Icons (24x24 viewBox、stroke-width:2)。`frontend/icons/` に SVG を追加し `frontend/ts/icons.ts` で参照
- 日本語コメント可。ただしコードで語れる内容は書かない — コメントは「なぜ」だけに絞る

## レイアウト規約 (csm から継承)

- メインレイアウトは CSS Grid
- Grid 子要素の overflow は `min-height: 0` を明示しないと効かない

## バックエンド規約 (csm から継承)

- Tauri コマンドは `src-tauri/src/commands/{domain}.rs` にドメインごとに分割
- フロントがバンドラレスで Tauri プラグインの JS API を直接 import できないため、プラグインを使う機能は Rust 側でラップした `#[tauri::command]` を追加し、JS からは `invoke('...')` で呼び出す

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
- Homebrew Cask (`brew install --cask cyocun/tap/askmd`、リリース公開時に自動更新)

## 未実装 / Phase 2 以降

- ターミナル連携モード (`Cmd+Shift+L` → iTerm/Terminal で `claude` 対話)
- Claude Desktop 連携 (API が来たら)
- 軽量編集 (`Cmd+E` → CodeMirror 6 ソース編集)
- 分割表示 (side-by-side 2 ファイル比較)
- macOS コード署名 / Notarization
