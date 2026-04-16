# askmd

> 静かで速い `.md` 専用ビューア + AI Q&A。Markdown ファイルを回遊して、気になった箇所を選択 → そのまま AI に質問。Claude / GitHub Copilot / ChatGPT に対応。

[English](README.md) · **日本語** · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## なぜ askmd？

Markdown ファイルはどこにでも溜まる — 設計メモ、議事録、調査サマリ、引き継ぎ資料、レビュー指摘まとめ。問題は「書くこと」ではなく、「後から読む」ときに毎回重厚なエディタを立ち上げるのが面倒なこと。

askmd はその隙間を埋める: **`.md` 専用のビューア + ディレクトリ回遊 + 選択範囲を AI に質問**。API キー管理不要 — ローカルにインストール済みの CLI を直接呼び出すだけ。

### 既存ツールとの比較

| ツール | askmd が解決する制約 |
|---|---|
| VS Code Markdown Preview | コードと混ざる。静かな読書モードがない |
| Obsidian | 重い。読むだけなのに Vault/プラグインがオーバーキル |
| Typora | 有料。エディタ寄りでビューア向きではない |
| MarkView | 単一ファイル専用。ディレクトリツリーがない |
| markdown-explorer | コンセプト一致だが 2018 年に停止 (Electron) |
| Ferrite | 軽量だが `.md` 以外も扱うエディタ |
| MDChat | CLI のみ。GUI やディレクトリ回遊がない |

**askmd の唯一の組み合わせ**: `.md` 専用 + ディレクトリツリー + 軽量 GUI + AI Q&A (キー管理不要)。

## 設計思想

すべての判断を支える5本柱:

1. **サクサク最優先** — Tauri (Rust + WebView)、バンドラなし、レンダリング結果をメモリキャッシュ。「Obsidian を開くのが億劫な気分でも askmd なら開ける」軽さが目標。
2. **キーボードファースト** — マウスに手を伸ばさず完結。`↑↓` で移動、`Enter` で開く、`@` で絞り込み、`Cmd+P` でスイッチ、`Cmd+L` で質問。
3. **`.md` に絞る** — JSON/YAML/コードファイル/隠しディレクトリはツリーに出さない。ノイズを減らす意志の表明であり、多機能化を防ぐ防波堤。
4. **AI は既存 CLI 流用** — API キー不要、追加課金なし。ローカルにインストール済みの CLI (`claude` / `gh copilot` / `chatgpt`) をサブプロセスで呼び出す。CLI がなくてもビューア単体として動く。
5. **ビューアであり、エディタではない** — 編集機能・ツールバー・保存ボタンなし。VS Code/Neovim/Zed で編集すれば askmd 側は即座に反映。

## 誰のため？

- Markdown ファイルが溜まっていて、速く・集中して読みたい人
- Markdown でドキュメントを共有しているチーム — デザイナーも PM もエンジニアも
- 読みながら「ここどういう意味？」を AI にその場で聞きたい人

AI の CLI がなくても、askmd はディレクトリツリー・キーボード操作・全文検索・ファイル監視を備えた軽量 `.md` ビューアとして使える。

## 機能

- `.md` だけのツリー (`.git` / `node_modules` / `.obsidian` などの隠しディレクトリはスキップ、`.md` を含まないディレクトリは畳まれる)
- レンダリング: markdown-it + highlight.js + DOMPurify
- Mermaid ダイアグラム + KaTeX 数式レンダリング
- キーボードファースト — マウス不要
- ファイル変更監視 (`notify` crate): 別エディタで保存すると即反映
- フロントマター抽出 → タイトル / 日付 / タグをヘッダーに表示
- `.md` 間の相対リンクで内部遷移、画像は同ディレクトリ基準
- 全文検索: `.md` を横断してテキストを検索 (`Cmd+F`)
- テーマシステム (GitHub Light/Dark, Solarized Light/Dark)
- **選択 → `Cmd+L` → 右ペインに AI の回答をストリーム表示** (CLI サブプロセス経由)

## キーボードショートカット

| キー | アクション |
|---|---|
| `↑` `↓` / `j` `k` | ツリー内移動 |
| `Enter` | ファイルを開く |
| `@` | インクリメンタル絞り込み |
| `Cmd+P` | クイックスイッチ |
| `Cmd+F` | 全文横断検索 |
| `Cmd+[` / `Cmd+]` | 履歴の戻る / 進む |
| `Cmd+L` | 選択範囲を AI に質問 |

## インストール / ビルド

<!-- ### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
``` -->

必要: Rust ツールチェーン、Node.js。

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # 開発モード
npm run tauri:build    # リリースビルド
```

ダイアログからディレクトリを開くか、ウィンドウにフォルダをドロップするか、引数で渡す:

```sh
askmd ~/my-notes
```

## 「AI に聞く」の仕組み

レンダリング表示内でテキストを選択 → `Cmd+L`。askmd がシステム上で利用可能な AI CLI を検出し、右上のメニューからプロバイダを選択できる。回答は右ペインにストリームで描画される。

対応プロバイダ:

| プロバイダ | CLI コマンド | ストリーミング |
|---|---|---|
| **Claude** | `claude` | 構造化 JSON ストリーミング (ツール使用対応) |
| **GitHub Copilot** | `gh copilot` | プレーンテキスト |
| **ChatGPT** | `chatgpt` | プレーンテキスト |

複数の CLI がインストールされていれば、メニューから切り替え可能。どれもインストールされていなければ、AI 機能は非表示になり、純粋なビューアとして動作する。

## AI CLI のセットアップ

AI Q&A 機能を使うには、以下のいずれかの CLI をインストールする。

### Claude (推奨)

Claude CLI は [Claude Code](https://docs.anthropic.com/en/docs/claude-code) の一部。Claude Pro / Max / Team プランが必要。

```sh
# npm でインストール
npm install -g @anthropic-ai/claude-code

# 初回セットアップ — ブラウザが開いて認証
claude
```

認証が済めば `claude` コマンドが使える。API キー不要 — askmd が直接呼び出す。

### GitHub Copilot

Copilot は [GitHub CLI](https://cli.github.com/) 経由で動作する。GitHub Copilot のサブスクリプションが必要 (無料枠あり)。

```sh
# macOS
brew install gh

# Windows
winget install GitHub.cli

# 認証して Copilot 拡張をインストール
gh auth login
gh extension install github/gh-copilot
```

ターミナルで `gh copilot` が動けば、askmd が自動検出する。

### ChatGPT

コミュニティ製の [chatgpt-cli](https://github.com/kardolus/chatgpt-cli) を使用。OpenAI API キーが必要。

```sh
# macOS
brew tap kardolus/chatgpt-cli
brew install chatgpt-cli

# API キーを設定
export OPENAI_API_KEY="sk-..."
```

ターミナルで `chatgpt` コマンドが動けば、askmd が自動検出する。

---

**CLI が入っていなくても大丈夫** — askmd はキーボード操作の速い `.md` ビューアとしてそのまま使える。CLI は好きなタイミングでインストールすれば、次回起動時に AI 機能が自動で現れる。

## ロードマップ

Phase 2 以降: ターミナル連携モード、軽量編集、分割表示、Homebrew Cask 配布。

## サポート

askmd が時間の節約になっているなら、[Ko-fi でコーヒーを奢ってくれると嬉しいです](https://ko-fi.com/cyocun)。完全に任意 — askmd は無料・MIT ライセンスのままです。

## ライセンス

MIT
