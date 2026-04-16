# askmd

> Un visor silencioso y rápido enfocado solo en `.md`, con Q&A de IA integrado. Navega tus archivos Markdown, selecciona un pasaje y pregúntale a la IA. Compatible con Claude / GitHub Copilot / ChatGPT.

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · **Español**

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## ¿Por qué askmd?

Los archivos Markdown se acumulan en todas partes — especificaciones de diseño, actas de reuniones, resúmenes de investigación, documentos de traspaso, síntesis de revisiones. El problema no es *escribirlos* — es *leerlos* después sin tener que abrir un editor pesado cada vez.

askmd llena ese hueco: **un visor exclusivamente de `.md` con navegación por directorios, más la capacidad de preguntarle a la IA sobre cualquier pasaje seleccionado**. Sin claves de API que gestionar — llama directamente a tus herramientas CLI instaladas localmente.

### Comparación con herramientas existentes

| Herramienta | Limitación que askmd resuelve |
|---|---|
| VS Code Markdown Preview | Documentos mezclados con código; sin modo de lectura tranquilo |
| Obsidian | Pesado; Vault/plugins excesivos para solo leer |
| Typora | De pago; orientado a edición, no a lectura |
| MarkView | Visor de archivo único; sin árbol de directorios |
| markdown-explorer | Concepto acertado pero abandonado en 2018 (Electron) |
| Ferrite | Ligero pero edita de todo, no es exclusivo de `.md` |
| MDChat | Solo CLI; sin GUI ni navegación de directorios |

**Combinación única de askmd**: exclusivo de `.md` + árbol de directorios + GUI ligera + Q&A con IA (sin gestión de claves).

## Filosofía de diseño

Cinco pilares que guían cada decisión:

1. **Instantáneo y ligero** — Tauri (Rust + WebView), sin bundler, renderizado cacheado en memoria. Objetivo: más ligero que Obsidian, para que nunca dudes en abrirlo.
2. **Teclado primero** — Navegación completa sin tocar el ratón. `↑↓` para explorar, `Enter` para abrir, `@` para filtrar, `Cmd+P` para cambiar, `Cmd+L` para preguntar.
3. **Solo `.md`** — Sin JSON, YAML, archivos de código ni directorios ocultos en el árbol. Una barrera de ruido deliberada que evita la expansión de funciones.
4. **IA mediante CLI existente** — Sin clave de API, sin facturación adicional. askmd llama a tu CLI instalada localmente (`claude`, `gh copilot` o `chatgpt`) como subproceso. Si no hay ninguna CLI instalada, askmd funciona como visor independiente.
5. **Visor, no editor** — Sin edición, barra de herramientas ni botón de guardar. Edita en VS Code/Neovim/Zed; askmd detecta los cambios y los refleja al instante.

## ¿Para quién es?

- Cualquiera que acumule archivos `.md` y quiera una forma rápida y enfocada de leerlos
- Equipos que comparten documentación en Markdown — diseñadores, PMs e ingenieros por igual
- Personas que quieren preguntarle a la IA sobre lo que están leyendo, sin salir del visor

Incluso sin ninguna CLI de IA instalada, askmd funciona como un visor ligero de `.md` con árbol de directorios, navegación por teclado, búsqueda de texto completo y observación de archivos.

## Características

- Árbol solo de `.md` (se omiten directorios ocultos como `.git`, `node_modules`, `.obsidian`; los directorios sin `.md` se colapsan)
- Renderizado con markdown-it + highlight.js + DOMPurify
- Diagramas Mermaid + renderizado de fórmulas KaTeX
- Navegación centrada en el teclado — ratón opcional
- Observación de archivos (`notify` crate): las ediciones en tu editor externo se reflejan al instante
- Extracción de front-matter → cabecera con título / fecha / etiquetas
- Navegación entre `.md` vía enlaces relativos; imágenes resueltas en el mismo directorio
- Búsqueda de texto completo en todos los archivos `.md` (`Cmd+F`)
- Sistema de temas (GitHub Light/Dark, Solarized Light/Dark)
- **Seleccionar → `Cmd+L` → respuesta de IA en streaming en el panel derecho** (vía subproceso CLI)

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `↑` `↓` / `j` `k` | Mover en el árbol |
| `Enter` | Abrir archivo |
| `@` | Filtro incremental |
| `Cmd+P` | Cambio rápido de archivo |
| `Cmd+F` | Búsqueda de texto completo |
| `Cmd+[` / `Cmd+]` | Atrás / adelante en historial |
| `Cmd+L` | Preguntar a la IA sobre el texto seleccionado |

## Instalación / Compilación

<!-- ### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
``` -->

Requisitos: toolchain de Rust, Node.js.

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # modo desarrollo
npm run tauri:build    # build de release
```

Abre un directorio desde el diálogo, arrastra una carpeta a la ventana, o pásalo como argumento:

```sh
askmd ~/my-notes
```

## Cómo funciona "Preguntar a la IA"

Selecciona texto en la vista renderizada y pulsa `Cmd+L`. askmd detecta qué herramientas CLI de IA están disponibles en tu sistema y te permite elegir un proveedor desde el menú superior derecho. La respuesta se transmite en streaming al panel derecho.

Proveedores compatibles:

| Proveedor | Comando CLI | Streaming |
|---|---|---|
| **Claude** | `claude` | Streaming JSON estructurado (con uso de herramientas) |
| **GitHub Copilot** | `gh copilot` | Texto plano |
| **ChatGPT** | `chatgpt` | Texto plano |

Si hay varias CLIs instaladas, puedes cambiar entre ellas desde el menú. Si no hay ninguna instalada, la función de IA se oculta y askmd funciona como visor puro.

## Guía de configuración de CLI de IA

La función de Q&A con IA requiere al menos una herramienta CLI instalada en tu sistema.

### Claude (recomendado)

La CLI de Claude es parte de [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Requiere un plan Claude Pro, Max o Team.

```sh
# Instalar vía npm
npm install -g @anthropic-ai/claude-code

# Primera configuración — abre el navegador para autenticarse
claude
```

Tras la autenticación, el comando `claude` está listo. Sin necesidad de clave API — askmd lo llama directamente.

### GitHub Copilot

Copilot funciona a través de [GitHub CLI](https://cli.github.com/). Requiere una suscripción a GitHub Copilot (hay nivel gratuito).

```sh
# macOS
brew install gh

# Windows
winget install GitHub.cli

# Autenticarse e instalar la extensión Copilot
gh auth login
gh extension install github/gh-copilot
```

Cuando `gh copilot` funcione en tu terminal, askmd lo detectará automáticamente.

### ChatGPT

Usa el [chatgpt-cli](https://github.com/kardolus/chatgpt-cli) de la comunidad. Requiere una clave API de OpenAI.

```sh
# macOS
brew tap kardolus/chatgpt-cli
brew install chatgpt-cli

# Configurar tu clave API
export OPENAI_API_KEY="sk-..."
```

Cuando el comando `chatgpt` funcione en tu terminal, askmd lo detectará automáticamente.

---

**¿No tienes ninguna CLI instalada?** No hay problema — askmd sigue funcionando como un visor rápido de `.md` con navegación por teclado. Puedes instalar una CLI en cualquier momento y la función de IA aparecerá automáticamente en el siguiente inicio.

## Hoja de ruta

Fase 2+: modo de paso a terminal, edición ligera, vista dividida, distribución por Homebrew Cask.

## Apoyo

Si askmd te ahorra tiempo, puedes [invitarme a un café en Ko-fi](https://ko-fi.com/cyocun). Totalmente opcional — askmd es gratis, licencia MIT, y así seguirá.

## Licencia

MIT
