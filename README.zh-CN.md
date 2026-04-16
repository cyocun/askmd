# askmd

> 专为 Claude Code 用户打造的、安静且快速的 `.md` 专用阅读器。浏览文档、选中段落、直接向 Claude 提问 —— 无需管理 API 密钥。

[English](README.md) · [日本語](README.ja.md) · **简体中文** · [한국어](README.ko.md) · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## 为什么选择 askmd？

日常使用 Claude Code 的话,`docs/` 里的 md 文件会迅速堆积 —— 设计笔记、调查摘要、交接文档、代码评审总结。问题不在于**写**,而在于每次**读**的时候都要启动一个重量级编辑器。

askmd 填补了这个空缺: **`.md` 专用阅读器 + 目录导航 + 选中内容直接问 Claude**。复用你已有的 `claude` CLI 认证,无需管理 API 密钥,也不会产生重复订阅费用。

### 与现有工具的对比

| 工具 | askmd 解决的限制 |
|---|---|
| VS Code Markdown Preview | 与代码混杂,没有安静的阅读模式 |
| Obsidian | 笨重; 只想阅读时 Vault/插件显得过度 |
| Typora | 付费; 编辑器优先,不适合纯阅读 |
| MarkView | 单文件查看器; 没有目录树 |
| markdown-explorer | 理念契合但 2018 年已停止维护 (Electron) |
| Ferrite | 轻量但非 `.md` 专用编辑器 |
| MDChat | 仅 CLI; 没有 GUI 和目录浏览 |

**askmd 独特的组合**: `.md` 专用 + 目录树 + 轻量 GUI + Claude CLI 问答 (零密钥管理)。

## 设计理念

塑造每个决策的五大支柱:

1. **极速轻量** — Tauri (Rust + WebView),无打包工具,渲染结果内存缓存。目标: 比 Obsidian 更轻,随时可以打开。
2. **键盘优先** — 无需触碰鼠标。`↑↓` 浏览、`Enter` 打开、`@` 筛选、`Cmd+P` 切换、`Cmd+L` 提问。
3. **仅限 `.md`** — 树中不显示 JSON、YAML、代码文件或隐藏目录。这是刻意的噪音屏障,防止功能蔓延。
4. **Claude 复用现有 CLI** — 无需 API 密钥,无额外账单。`claude -p` 子进程复用你的 Max/Pro 订阅。类似 Cursor 的"对选中内容提问"体验,在本地、在现有订阅内实现。
5. **阅读器,不是编辑器** — 没有编辑功能、工具栏或保存按钮。在 VS Code/Neovim/Zed 中编辑,askmd 监测变更并即时反映。

## 面向谁?

- 已经安装并配置好 `claude` CLI 的 Claude Code 用户
- `docs/` 下积累了数十到数百个 `.md` 文件的人
- 阅读者,而非写作者 (写作请用你喜欢的编辑器; askmd 只负责读)

不适合: 想要 Markdown **编辑器** 的人、需要笔记管理功能 (反向链接、图谱视图) 的人、不使用 Claude Code 的人。

## 功能

- `.md` 专属树视图 (跳过 `.git` / `node_modules` / `.obsidian` 等隐藏目录,不含 `.md` 的目录自动折叠隐藏)
- 渲染: markdown-it + highlight.js + DOMPurify
- 键盘优先 —— 可不用鼠标
- 文件变更监听 (`notify` crate): 在外部编辑器保存后即时反映
- Front-matter 解析 → 标题 / 日期 / 标签显示在顶部
- `.md` 之间相对链接跳转; 图片按同目录解析
- 全文搜索: 跨所有 `.md` 文件搜索文本 (`Cmd+F`)
- **选中 → `Cmd+L` → Claude 答案流式显示在右侧面板** (通过 `claude -p` 子进程)

## 键盘快捷键

| 按键 | 动作 |
|---|---|
| `↑` `↓` / `j` `k` | 在树中移动 |
| `Enter` | 打开文件 |
| `@` | 增量筛选 |
| `Cmd+P` | 快速切换文件 |
| `Cmd+F` | 全文横跨搜索 |
| `Cmd+[` / `Cmd+]` | 历史后退 / 前进 |
| `Cmd+L` | 对选中文本向 Claude 提问 |

## 安装 / 构建

### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
```

### 从源码构建

需要: Rust 工具链、Node.js、`PATH` 中包含 `claude` CLI。

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # 开发模式
npm run tauri:build    # 构建发布包
```

通过对话框打开目录,将文件夹拖放到窗口,或作为参数传递:

```sh
askmd ~/myrepo/docs
```

## "问 Claude" 的工作原理

在渲染视图中选中文本,按 `Cmd+L`。askmd 会以子进程运行 `claude -p "<包含选中内容的提示>"`,并将回答以流式方式显示在右侧面板。无需配置 API 密钥,无需单独付费 —— 直接使用你已有的 Claude Code 订阅。

未来计划: 终端直通模式 (通过 iTerm/Terminal 进行更长的对话)、Claude Desktop 深层链接支持。

## 路线图

Phase 1 (MVP,进行中): 树形视图、渲染、键盘导航、文件监听、全文搜索、流式 `Cmd+L` 问答。

Phase 2+: tantivy 驱动的搜索、终端模式、最近目录 UI、自动更新器、发布分发。

## 支持

如果 askmd 为你节省了时间,欢迎[在 Ko-fi 上请我喝一杯咖啡](https://ko-fi.com/cyocun)。完全自愿 —— askmd 永久免费,采用 MIT 许可证。

## 许可证

MIT
