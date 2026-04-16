# askmd

> 安静、快速的 `.md` 专用阅读器，内置 AI 问答。浏览 Markdown 文件、选中段落、直接向 AI 提问。支持 Claude / GitHub Copilot / ChatGPT。

[English](README.md) · [日本語](README.ja.md) · **简体中文** · [한국어](README.ko.md) · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## 为什么选择 askmd？

Markdown 文件到处都在堆积 —— 设计规格、会议记录、调查摘要、交接文档、代码评审总结。问题不在于**写**，而在于每次**读**的时候都要启动一个重量级编辑器。

askmd 填补了这个空缺: **`.md` 专用阅读器 + 目录导航 + 选中内容直接问 AI**。无需管理 API 密钥 —— 直接调用本地已安装的 CLI 工具。

### 与现有工具的对比

| 工具 | askmd 解决的限制 |
|---|---|
| VS Code Markdown Preview | 与代码混杂，没有安静的阅读模式 |
| Obsidian | 笨重; 只想阅读时 Vault/插件显得过度 |
| Typora | 付费; 编辑器优先，不适合纯阅读 |
| MarkView | 单文件查看器; 没有目录树 |
| markdown-explorer | 理念契合但 2018 年已停止维护 (Electron) |
| Ferrite | 轻量但非 `.md` 专用编辑器 |
| MDChat | 仅 CLI; 没有 GUI 和目录浏览 |

**askmd 独特的组合**: `.md` 专用 + 目录树 + 轻量 GUI + AI 问答 (零密钥管理)。

## 设计理念

塑造每个决策的五大支柱:

1. **极速轻量** — Tauri (Rust + WebView)，无打包工具，渲染结果内存缓存。目标: 比 Obsidian 更轻，随时可以打开。
2. **键盘优先** — 无需触碰鼠标。`↑↓` 浏览、`Enter` 打开、`@` 筛选、`Cmd+P` 切换、`Cmd+L` 提问。
3. **仅限 `.md`** — 树中不显示 JSON、YAML、代码文件或隐藏目录。这是刻意的噪音屏障，防止功能蔓延。
4. **AI 复用现有 CLI** — 无需 API 密钥，无额外账单。askmd 调用本地已安装的 CLI (`claude`、`gh copilot` 或 `chatgpt`) 作为子进程。即使没有安装任何 CLI，askmd 仍可作为独立阅读器使用。
5. **阅读器，不是编辑器** — 没有编辑功能、工具栏或保存按钮。在 VS Code/Neovim/Zed 中编辑，askmd 监测变更并即时反映。

## 面向谁?

- 积累了大量 `.md` 文件，想要快速、专注阅读的人
- 用 Markdown 共享文档的团队 —— 设计师、产品经理、工程师都适用
- 想在阅读时随时向 AI 提问的人

即使没有安装任何 AI CLI，askmd 也可以作为轻量 `.md` 阅读器使用，具备目录树、键盘导航、全文搜索和文件监听功能。

## 功能

- `.md` 专属树视图 (跳过 `.git` / `node_modules` / `.obsidian` 等隐藏目录，不含 `.md` 的目录自动折叠隐藏)
- 渲染: markdown-it + highlight.js + DOMPurify
- Mermaid 图表 + KaTeX 数学公式渲染
- 键盘优先 —— 可不用鼠标
- 文件变更监听 (`notify` crate): 在外部编辑器保存后即时反映
- Front-matter 解析 → 标题 / 日期 / 标签显示在顶部
- `.md` 之间相对链接跳转; 图片按同目录解析
- 全文搜索: 跨所有 `.md` 文件搜索文本 (`Cmd+F`)
- 主题系统 (GitHub Light/Dark, Solarized Light/Dark)
- **选中 → `Cmd+L` → AI 答案流式显示在右侧面板** (通过 CLI 子进程)

## 键盘快捷键

| 按键 | 动作 |
|---|---|
| `↑` `↓` / `j` `k` | 在树中移动 |
| `Enter` | 打开文件 |
| `@` | 增量筛选 |
| `Cmd+P` | 快速切换文件 |
| `Cmd+F` | 全文横跨搜索 |
| `Cmd+[` / `Cmd+]` | 历史后退 / 前进 |
| `Cmd+L` | 对选中文本向 AI 提问 |

## 安装 / 构建

<!-- ### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
``` -->

需要: Rust 工具链、Node.js。

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # 开发模式
npm run tauri:build    # 构建发布包
```

通过对话框打开目录，将文件夹拖放到窗口，或作为参数传递:

```sh
askmd ~/my-notes
```

## "问 AI" 的工作原理

在渲染视图中选中文本，按 `Cmd+L`。askmd 检测系统上可用的 AI CLI 工具，你可以从右上角菜单选择提供商。回答以流式方式显示在右侧面板。

支持的提供商:

| 提供商 | CLI 命令 | 流式传输 |
|---|---|---|
| **Claude** | `claude` | 结构化 JSON 流式传输 (支持工具调用) |
| **GitHub Copilot** | `gh copilot` | 纯文本 |
| **ChatGPT** | `chatgpt` | 纯文本 |

如果安装了多个 CLI，可以从菜单中切换。如果没有安装任何 CLI，AI 功能会隐藏，askmd 作为纯阅读器运行。

## AI CLI 设置指南

AI 问答功能需要至少安装一个 CLI 工具。

### Claude (推荐)

Claude CLI 是 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 的一部分。需要 Claude Pro / Max / Team 计划。

```sh
# 通过 npm 安装
npm install -g @anthropic-ai/claude-code

# 首次设置 — 打开浏览器进行认证
claude
```

认证完成后 `claude` 命令即可使用。无需 API 密钥 — askmd 直接调用。

### GitHub Copilot

Copilot 通过 [GitHub CLI](https://cli.github.com/) 运行。需要 GitHub Copilot 订阅 (有免费额度)。

```sh
# macOS
brew install gh

# Windows
winget install GitHub.cli

# 认证并安装 Copilot 扩展
gh auth login
gh extension install github/gh-copilot
```

终端中 `gh copilot` 可用后，askmd 会自动检测。

### ChatGPT

使用社区维护的 [chatgpt-cli](https://github.com/kardolus/chatgpt-cli)。需要 OpenAI API 密钥。

```sh
# macOS
brew tap kardolus/chatgpt-cli
brew install chatgpt-cli

# 设置 API 密钥
export OPENAI_API_KEY="sk-..."
```

终端中 `chatgpt` 命令可用后，askmd 会自动检测。

---

**没有安装 CLI？** 没关系 — askmd 仍可作为快速的键盘驱动 `.md` 阅读器使用。随时安装 CLI，下次启动时 AI 功能会自动出现。

## 路线图

Phase 2+: 终端直通模式、轻量编辑、分屏视图、Homebrew Cask 分发。

## 支持

如果 askmd 为你节省了时间，欢迎[在 Ko-fi 上请我喝一杯咖啡](https://ko-fi.com/cyocun)。完全自愿 — askmd 永久免费，采用 MIT 许可证。

## 许可证

MIT
