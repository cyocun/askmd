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
- **AI 連携は既存 CLI 流用**: API キー管理はしない。`claude -p` / `copilot -p` / `codex exec` をサブプロセスで呼ぶ。CLI がなくてもビューア単体で動作
- **対象ターゲット**: A=デザイナー/PM (Markdown 書ける、ターミナルは触らない)、B=ライター/リサーチャー (読み主体)。エンジニアは副次対象だが体験を犠牲にしない
- **表面はシンプル、深部に高度機能 (Progressive Disclosure)**: 非エンジニアは見えている範囲で完結、エンジニアは掘れば全部触れる。機能追加時はまず「前面に出すか奥に隠すか」を判断する

## AI への質問の仕組み

- **右コメント列 (Google Docs 風)**: 選択 → `Cmd+L`/選択バー「聞く」→ 選択中のプロバイダ CLI を子プロセス実行 → 右側の `#commentsPane` に Q&A カードを文書順に積む。本文は押し下げない。質問が出ると `body.has-comments` で列展開、ゼロで畳む。カードはファイル単位で出し分け、引用元クリックで本文へジャンプ＋ハイライト (旧インライン挿入は廃止)
- 対応プロバイダ (いずれもファイル Read 可能なエージェント型 CLI): Claude (`claude -p --output-format stream-json`、構造化ストリーミング＋`--resume` 継続)、Copilot (新単体 `copilot -p <prompt> -s`、旧 `gh copilot` は 2025-10 非推奨)、Codex (`codex exec <prompt>`、旧 `chatgpt` から移行)
- プロンプト (`ask.ts` buildPrompt): 初回は「全文 (raw md, 最大8000字)＋選択抜粋 (プレーン)＋質問」。選択抜粋は意図的にプレーン (記法は全文側で生きている)。ツール指示はプロバイダ非依存の中立文面。継続は Claude のセッション resume のみ実質機能 (Copilot/Codex も resume はあるが未配線)
- プロバイダは起動時に `which` で自動検出。複数あればメニューから切替可能。ゼロならビューアモード
- 将来: ターミナルで開くモード (`osascript` 経由で Terminal/iTerm に `claude` を流す)、Claude Desktop 連携 (現状 deep link でプロンプトプリフィル不可、将来対応)

## 編集モデル (2026-04-17 時点の考え方)

askmd は「読むが主、書くは補助」。新規作成も画像差し込みも意図的にやらない — **既存 md の文字を選択単位でちょい直しする、それだけ**に絞る。ファイル本体は Markdown のまま、装飾は decoration のみ、という絶対条件でラウンドトリップ事故ゼロを維持する。

### 選択範囲だけの mini editor (選択フロートバー → 鉛筆 / `⌘E`)
- 本文を選択 → 選択フロートバーの **鉛筆アイコン** or `⌘E` → 小さな CM6 popover が浮かぶ
- 選択プレーンテキストを Markdown body の中で `indexOf` 検索 → 見つかった offset range だけを mini editor に投入
- 検索で見つからない (記法をまたぐ選択 = DOM selection.toString() が body 原文と不一致) 時は、**anchor block (`data-lines` 持ち) 全体にフォールバック**して block 丸ごと編集可能にする
- `⌘S` で body の該当 offset を置換、frontmatter は split/restore で常に保持
- 選択なしで `⌘E` を押しても何も起きない (無反応)

### ソース全体編集モードも WYSIWYG も入れない理由
一度 Ixora ベースの WYSIWYG (Typora 流) + テーブル block widget、そして CM6 + HighlightStyle でのソース全体編集モード (`⌘E` で reading ↔ source トグル) を実装したが、いずれも却下した:

- **ソース全体編集 (旧 `⌘E`)**: 「ファイル全体を書き換えたい」ニーズは askmd で満たすべきではない。構造変更や大幅書き換えは VS Code 等の外部エディタに委ねる。全体編集モードを残すと「書くツール」としての期待値が生まれ、複雑度が連鎖的に膨らむ。`create_new_markdown` は自分用の抜け道として右クリック奥に残すが、主流の UI には出さない
- **Ixora (Typora 流)**: カーソル行で記号がパタパタ切替わるのが気が散る。table / Mermaid / KaTeX / admonition / `==mark==` の装飾を自作するコストも大きい
- **Milkdown / TipTap**: ProseMirror 系は `==mark==` / admonition の自前プラグインが必要 + UI 整合コスト
- **素の contenteditable**: WebKit の IME / Enter / paste 挙動の地雷で日本語入力を壊すリスク

採用したのは **選択 → mini editor の一点のみ**。round-trip は数学的に保証 (触るのは選択 offset 範囲だけ)。ファイル全体の書き換えが必要になったら外部エディタで開けば済む。

### 「不便が出た時」の打ち手
段階的に拡張する方針。先回りしない:
1. まずは数週間使って実際のストレスを計測する
2. 読むモードの table 編集が辛いなら、**table だけ contenteditable を差し込む** (地雷面積が table 内に限定される最小介入)
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
- AI プロバイダ切替 (Claude / Copilot / Codex)
- LLM なしビューアモード (AI 不在時はプロバイダ非表示)
- 全文横断検索 (`Cmd+F`、tantivy ベースの高速全文検索)
- Claude 回答ストリーミング
- ツリーに frontmatter title 表示
- IME composing 対応
- 翻訳機能 (`Cmd+Shift+T`、Google Translate 非公式 API、API キー不要)
- 最近開いたディレクトリの永続化 (起動画面に最大 5 件表示)
- `.md` ファイルアソシエーション (Finder からダブルクリックで開く)
- 自動アップデータ (`tauri-plugin-updater`、起動 5 秒後 + 6 時間周期、サイレント更新)。`tauri.conf.json` の `pubkey` と GitHub Secrets (`TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) で署名
- GitHub Actions リリースワークフロー (`v*` タグで Apple Silicon (aarch64) 向けの .dmg + `.sig` + `latest.json` を自動生成して即公開)。Intel Mac は対象外 — matrix で arm64+x64 を並列ビルドすると `tauri-action` が各 job 内で両 arch の署名を見つけられず `latest.json` の生成を skip してしまうため、`runs-on: macos-14` 固定で native (arm64) 単一ビルドに割り切っている。`verify-updater-json` job で `latest.json` 欠落を必ず検出

### Phase 2
- Vite バンドラ導入 (vendor/ 全廃止、npm パッケージ化、`@tauri-apps/api` 正規 import)
- コードブロックのコピーボタン (ホバーで Copy ボタン表示)
- 読書位置の記憶 (localStorage に永続化、ファイル再オープン時に復元)
- AI にファイル全体をコンテキスト (選択なし Cmd+L でファイル全体について質問可能)
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
- ツリー内 md ドラッグ移動 — ファイル行を `draggable`、ディレクトリ行がドロップ先。`move_file` コマンドで `fs::rename`
- 新コマンド: `rename_file` / `duplicate_file` / `move_file` / `create_new_markdown` / `get_recent_files`
- 選択範囲 mini editor (選択フロートバー → 鉛筆 / `⌘E`) — 本文選択 → 小さな CM6 popover で該当 offset を編集。記法またぎは anchor block にフォールバック (`data-lines` 利用)。`⌘S` で保存、選択なし `⌘E` は無反応。ファイル全体は触らないので round-trip 事故ゼロ

## Phase 3 残 / Phase 4 候補

### 未着手 (意図的に後回し)
- **初回起動オンボーディング** (3 画面: フォルダ選択 / AI は任意 / 主要操作チートシート)
- **外部 (Finder/Slack) へのドラッグ書き出し** (Tauri のネイティブ drag-out サポート状況要調査)
- 「未読」入口 (既読管理のためのメタデータが別途必要)
- Ask 継続会話の「ここまでを送る」操作 (現状は Claude CLI の sessionId 任せ)

### 後回し / 検討中
- macOS コード署名 / Notarization
- Homebrew Cask (`brew install --cask cyocun/tap/askmd`、`update-homebrew.yml` は書いてあるが `homebrew-tap` repo 未整備のため現状 `workflow_dispatch` のみで封印中)
- ターミナル連携モード (`Cmd+Shift+L` → iTerm/Terminal で `claude` 対話)
- Claude Desktop 連携 (deep link でのプロンプトプリフィル API が来たら)
- ウィンドウタブ (`Cmd+T`、複数フォルダ同時オープン)
- 共有メニュー (macOS 共有シート: メール、メモ、AirDrop)
- 分割表示 (side-by-side 2 ファイル比較)
- スクロールバーのスタイリング (細い常時表示 or ホバーで出現)
- ドラッグでサイドバー幅調整
- `app.ts` (~1700 行) の `state.ts` / `keymap.ts` 分割 — Phase 3 で selection-bar / translate-popover / context-menu / prompt-modal / ask-history は分離済
