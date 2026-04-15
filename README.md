# askmd

> A quiet, fast `.md`-only viewer for Claude Code users. Browse your docs, select a passage, and ask Claude — without juggling API keys.

**English** · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## Why askmd?

If you use Claude Code daily, your `docs/` folder fills up fast: design notes, investigation summaries, handover docs, review digests. The problem isn't *writing* them — it's *reading* them later without firing up a heavyweight editor every time.

- **VS Code Markdown Preview** mixes docs with code noise
- **Obsidian** is powerful but heavy, with Vault concepts and plugins you don't need to just *read*
- **Typora** is paid and editor-first
- **markdown-explorer** had the right idea but stopped in 2018
- **Ferrite** is lightweight but edits everything, not just `.md`

`askmd` fills the gap: **a `.md`-only viewer with directory navigation, plus the ability to ask Claude about any selected passage** — reusing your existing `claude` CLI auth, so there are no API keys to manage.

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
- **Select → `Cmd+L` → Claude answers in the right pane** (via `claude -p` subprocess)

## Keyboard shortcuts

| Key | Action |
|---|---|
| `↑` `↓` / `j` `k` | Move in tree |
| `Enter` | Open file |
| `/` | Incremental filter |
| `Cmd+P` | Quick file switcher |
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

Open a directory via the dialog, or pass it as an argument:

```sh
askmd ~/myrepo/docs
```

## How "Ask Claude" works

Select text in the rendered view and press `Cmd+L`. `askmd` runs `claude -p "<your prompt with selection>"` as a subprocess and streams the answer into the right pane. No API key configuration, no separate billing — your existing Claude Code subscription does the work.

A future terminal-passthrough mode (for longer interactive sessions via iTerm/Terminal) and Claude Desktop deep-link support are planned.

## Roadmap

Phase 1 (MVP, in progress): tree, rendering, keyboard nav, file watching, `Cmd+L` inline Q&A.

Phase 2+: full-text search (tantivy), terminal mode, recent-directories UI, auto-updater, release distribution.

See [docs/CONCEPT.md](docs/CONCEPT.md) for background, design philosophy, and the full comparison table.

## Support

If `askmd` saves you time, you can [buy me a coffee on Ko-fi](https://ko-fi.com/cyocun). It's entirely optional — `askmd` is free, MIT-licensed, and will stay that way.

## License

MIT
