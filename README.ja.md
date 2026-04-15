# askmd

> Claude Code ユーザー向けの、静かで速い `.md` 専用ビューア。docs を回遊して、気になった箇所を選択 → そのまま Claude に質問。API キー管理は不要。

[English](README.md) · **日本語** · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## なぜ askmd？

Claude Code を日常的に使っていると、`docs/` にはあっという間に md が溜まる — 設計メモ、調査サマリ、引き継ぎ資料、レビュー指摘まとめ。問題は「書くこと」ではなく、「後から読む」ときに毎回重厚なエディタを立ち上げるのが面倒なこと。

- **VS Code Markdown Preview**: コードと混ざって視界が賑やかすぎる
- **Obsidian**: 強力だが重い。Vault 概念やプラグインは「読むだけ」の用途にはオーバーキル
- **Typora**: 有料でエディタ寄り
- **markdown-explorer**: コンセプト一致だが 2018 年で停止
- **Ferrite**: 軽量だが `.md` 以外も扱うエディタ

askmd はその隙間を埋める: **`.md` 専用のビューア + ディレクトリ回遊 + 選択範囲を Claude に質問**。既存の `claude` CLI 認証をそのまま流用するので、API キー管理も課金の二重化もなし。

## 誰のため？

- `claude` CLI を既にセットアップしている Claude Code ユーザー
- `docs/` に md を数十〜数百溜め込んでいる人
- 読む人 (書くのは VS Code などで。askmd は読むだけ)

対象外: Markdown を **書く** 道具が欲しい人、ノート管理 (バックリンク・グラフビュー) が欲しい人、Claude Code を使っていない人。

## 機能

- `.md` だけのツリー (`.git` / `node_modules` / `.obsidian` などの隠しディレクトリはスキップ、`.md` を含まないディレクトリは畳まれる)
- レンダリング: markdown-it + highlight.js + DOMPurify
- キーボードファースト — マウス不要
- ファイル変更監視 (`notify` crate): 別エディタで保存すると即反映
- フロントマター抽出 → タイトル / 日付 / タグをヘッダーに表示
- `.md` 間の相対リンクで内部遷移、画像は同ディレクトリ基準
- **選択 → `Cmd+L` → 右ペイン下部に Claude の回答** (`claude -p` サブプロセス経由)

## キーボードショートカット

| キー | アクション |
|---|---|
| `↑` `↓` / `j` `k` | ツリー内移動 |
| `Enter` | ファイルを開く |
| `/` | インクリメンタル絞り込み |
| `Cmd+P` | クイックスイッチ |
| `Cmd+[` / `Cmd+]` | 履歴の戻る / 進む |
| `Cmd+L` | 選択範囲を Claude に質問 |

## インストール / ビルド

必要: Rust ツールチェーン、Node.js、`claude` CLI が `PATH` にあること。

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # 開発モード
npm run tauri:build    # リリースビルド
```

ダイアログからディレクトリを開くか、引数で渡す:

```sh
askmd ~/myrepo/docs
```

## 「Claude に聞く」の仕組み

レンダリング表示内でテキストを選択 → `Cmd+L`。askmd が `claude -p "<選択範囲を含むプロンプト>"` をサブプロセスで実行し、結果を右ペインにストリームで描画する。API キー設定や別課金は不要 — 既存の Claude Code サブスクがそのまま使われる。

将来: ターミナル連携モード (iTerm/Terminal 経由で対話継続)、Claude Desktop ディープリンク対応を検討中。

## ロードマップ

Phase 1 (MVP、実装中): ツリー・レンダリング・キーボードナビ・ファイル監視・`Cmd+L` インライン Q&A。

Phase 2 以降: 全文検索 (tantivy)、ターミナル連携、最近開いたリスト UI、自動アップデータ、リリース配布。

背景・設計思想・既存ツールとの比較は [docs/CONCEPT.md](docs/CONCEPT.md) を参照。

## サポート

askmd が時間の節約になっているなら、[Ko-fi でコーヒーを奢ってくれると嬉しいです](https://ko-fi.com/cyocun)。完全に任意 — askmd は無料・MIT ライセンスのままです。

## ライセンス

MIT
