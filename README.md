# askmd

> A quiet, fast `.md`-only viewer with built-in AI Q&A. Browse your Markdown files, select a passage, and ask AI — powered by Claude, GitHub Copilot, or ChatGPT.

**English** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## Why askmd?

Markdown files pile up everywhere — design specs, meeting notes, investigation summaries, handover docs, review digests. The problem isn't *writing* them — it's *reading* them later without firing up a heavyweight editor every time.

`askmd` fills the gap: **a `.md`-only viewer with directory navigation, plus the ability to ask AI about any selected passage**. No API keys to manage — it calls your locally installed CLI tools directly.

### How askmd compares

| Tool | Limitation askmd addresses |
|---|---|
| VS Code Markdown Preview | Docs mixed with code; no quiet reading mode |
| Obsidian | Heavy; Vault/plugins overkill for read-only use |
| Typora | Paid; editor-first, not viewer-first |
| MarkView | Single-file viewer; no directory tree |
| markdown-explorer | Right concept, but abandoned since 2018 (Electron) |
| Ferrite | Lightweight, but edits everything — not `.md`-only |
| MDChat | CLI-only; no GUI or directory browsing |

**askmd's unique combination**: `.md`-only + directory tree + lightweight GUI + AI Q&A with zero key management.

## Design philosophy

Five pillars that shape every decision:

1. **Instant & lightweight** — Tauri (Rust + WebView), no bundler, memory-cached renders. The goal: lighter than Obsidian, so you never hesitate to open it.
2. **Keyboard-first** — Full navigation without touching the mouse. `↑↓` to browse, `Enter` to open, `@` to filter, `Cmd+P` to switch, `Cmd+L` to ask.
3. **`.md` only** — No JSON, YAML, code files, or hidden directories in the tree. This is a deliberate noise barrier that prevents feature creep.
4. **AI via existing CLI** — No API key, no separate billing. askmd calls your locally installed CLI (`claude`, `gh copilot`, or `chatgpt`) as a subprocess. If none is installed, askmd still works as a standalone viewer.
5. **Viewer, not editor** — No editing, no toolbar, no save button. Edit in VS Code/Neovim/Zed; askmd watches for changes and reflects them instantly.

## Who is it for?

- Anyone who accumulates `.md` files and wants a fast, focused way to read them
- Teams sharing Markdown documentation — designers, PMs, engineers alike
- People who want to ask AI about what they're reading, without leaving the viewer

Even without any AI CLI installed, askmd works as a lightweight `.md` viewer with directory tree, keyboard navigation, full-text search, and file watching.

## Features

- `.md`-only tree (hidden dirs like `.git`, `node_modules`, `.obsidian` are skipped; dirs without `.md` are collapsed away)
- Rendering via markdown-it + highlight.js + DOMPurify
- Mermaid diagrams + KaTeX math rendering
- Keyboard-first navigation — mouse optional
- File-watching (`notify` crate): edits in your external editor reflect instantly
- Front-matter extraction → title / date / tags header
- Relative-link navigation between `.md` files; same-dir image resolution
- Full-text search across all `.md` files (`Cmd+F`)
- Theme system (GitHub Light/Dark, Solarized Light/Dark)
- **Select → `Cmd+L` → AI answers in the right pane** (streamed via CLI subprocess)

## Keyboard shortcuts

| Key | Action |
|---|---|
| `↑` `↓` / `j` `k` | Move in tree |
| `Enter` | Open file |
| `@` | Incremental filter |
| `Cmd+P` | Quick file switcher |
| `Cmd+F` | Full-text search across files |
| `Cmd+[` / `Cmd+]` | History back / forward |
| `Cmd+L` | Ask AI about the selected passage |

## Install / Build

<!-- ### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
``` -->

Requirements: Rust toolchain, Node.js.

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # run in dev mode
npm run tauri:build    # build release bundle
```

Open a directory via the dialog, drop a folder onto the window, or pass it as an argument:

```sh
askmd ~/my-notes
```

## How "Ask AI" works

Select text in the rendered view and press `Cmd+L`. askmd detects which AI CLI tools are available on your system and lets you pick a provider from the top-right menu. The answer is streamed into the right pane.

Supported providers:

| Provider | CLI command | Streaming |
|---|---|---|
| **Claude** | `claude` | Structured JSON streaming with tool use |
| **GitHub Copilot** | `gh copilot` | Plain text |
| **ChatGPT** | `chatgpt` | Plain text |

If multiple CLIs are installed, you can switch between them from the provider menu. If none are installed, the AI feature is simply hidden and askmd works as a pure viewer.

## Setting up AI CLIs

The AI Q&A feature requires at least one CLI tool installed on your system. Here's how to set each one up.

### Claude (recommended)

Claude CLI is part of [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Requires a Claude Pro, Max, or Team plan.

```sh
# Install via npm
npm install -g @anthropic-ai/claude-code

# First-time setup — opens browser to authenticate
claude
```

After authentication, the `claude` command is ready. No API key needed — askmd calls it directly.

### GitHub Copilot

Copilot works through the [GitHub CLI](https://cli.github.com/). Requires a GitHub Copilot subscription (free tier available).

```sh
# macOS
brew install gh

# Windows
winget install GitHub.cli

# Then authenticate and install the Copilot extension
gh auth login
gh extension install github/gh-copilot
```

Once `gh copilot` works in your terminal, askmd will detect it automatically.

### ChatGPT

Uses the community [chatgpt-cli](https://github.com/kardolus/chatgpt-cli). Requires an OpenAI API key.

```sh
# macOS
brew tap kardolus/chatgpt-cli
brew install chatgpt-cli

# Set your API key
export OPENAI_API_KEY="sk-..."
```

Once the `chatgpt` command works in your terminal, askmd will pick it up.

---

**No CLI installed?** That's fine — askmd still works as a fast, keyboard-driven `.md` viewer. You can install a CLI anytime and the AI feature will appear automatically on next launch.

## Roadmap

Phase 2+: terminal passthrough mode, lightweight editing, split view, Homebrew Cask distribution.

## Support

If `askmd` saves you time, you can [buy me a coffee on Ko-fi](https://ko-fi.com/cyocun). It's entirely optional — `askmd` is free, MIT-licensed, and will stay that way.

## License

MIT
