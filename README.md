# askmd

> A quiet, fast `.md`-only viewer for Claude Code users. Browse your docs, select a passage, and ask Claude — without juggling API keys.

**English** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## Why askmd?

If you use Claude Code daily, your `docs/` folder fills up fast: design notes, investigation summaries, handover docs, review digests. The problem isn't *writing* them — it's *reading* them later without firing up a heavyweight editor every time.

`askmd` fills the gap: **a `.md`-only viewer with directory navigation, plus the ability to ask Claude about any selected passage** — reusing your existing `claude` CLI auth, so there are no API keys to manage.

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

**askmd's unique combination**: `.md`-only + directory tree + lightweight GUI + Claude CLI Q&A with zero key management.

## Design philosophy

Five pillars that shape every decision:

1. **Instant & lightweight** — Tauri (Rust + WebView), no bundler, memory-cached renders. The goal: lighter than Obsidian, so you never hesitate to open it.
2. **Keyboard-first** — Full navigation without touching the mouse. `↑↓` to browse, `Enter` to open, `@` to filter, `Cmd+P` to switch, `Cmd+L` to ask.
3. **`.md` only** — No JSON, YAML, code files, or hidden directories in the tree. This is a deliberate noise barrier that prevents feature creep.
4. **Claude via existing CLI** — No API key, no separate billing. `claude -p` subprocess reuses your Max/Pro subscription. A Cursor-like "ask about selection" experience, locally, within your existing plan.
5. **Viewer, not editor** — No editing, no toolbar, no save button. Edit in VS Code/Neovim/Zed; askmd watches for changes and reflects them instantly.

## Who is it for?

- Claude Code users who already have the `claude` CLI set up
- People who accumulate dozens to hundreds of `.md` files in `docs/`
- Readers, not writers (edit with your favorite editor; `askmd` just reads)

Not for: people who want a Markdown *editor*, note-management features (backlinks, graph view), or users without Claude Code.

## Features

- `.md`-only tree (hidden dirs like `.git`, `node_modules`, `.obsidian` are skipped; dirs without `.md` are collapsed away)
- Rendering via markdown-it + highlight.js + DOMPurify
- Keyboard-first navigation — mouse optional
- File-watching (`notify` crate): edits in your external editor reflect instantly
- Front-matter extraction → title / date / tags header
- Relative-link navigation between `.md` files; same-dir image resolution
- Full-text search across all `.md` files (`Cmd+F`)
- **Select → `Cmd+L` → Claude answers in the right pane** (streamed via `claude -p` subprocess)

## Keyboard shortcuts

| Key | Action |
|---|---|
| `↑` `↓` / `j` `k` | Move in tree |
| `Enter` | Open file |
| `@` | Incremental filter |
| `Cmd+P` | Quick file switcher |
| `Cmd+F` | Full-text search across files |
| `Cmd+[` / `Cmd+]` | History back / forward |
| `Cmd+L` | Ask Claude about the selected passage |

## Install / Build

Requirements: Rust toolchain, Node.js, `claude` CLI on `PATH`.

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # run in dev mode
npm run tauri:build    # build release bundle
```

Open a directory via the dialog, drop a folder onto the window, or pass it as an argument:

```sh
askmd ~/myrepo/docs
```

## How "Ask Claude" works

Select text in the rendered view and press `Cmd+L`. `askmd` runs `claude -p "<your prompt with selection>"` as a subprocess and streams the answer into the right pane. No API key configuration, no separate billing — your existing Claude Code subscription does the work.

A future terminal-passthrough mode (for longer interactive sessions via iTerm/Terminal) and Claude Desktop deep-link support are planned.

## Roadmap

Phase 1 (MVP, in progress): tree, rendering, keyboard nav, file watching, full-text search, streaming `Cmd+L` Q&A.

Phase 2+: tantivy-powered search, terminal mode, recent-directories UI, auto-updater, release distribution.

## Support

If `askmd` saves you time, you can [buy me a coffee on Ko-fi](https://ko-fi.com/cyocun). It's entirely optional — `askmd` is free, MIT-licensed, and will stay that way.

## License

MIT
