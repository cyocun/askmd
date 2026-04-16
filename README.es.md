# askmd

> Un visor silencioso y rápido enfocado solo en `.md`, pensado para usuarios de Claude Code. Navega tus documentos, selecciona un pasaje y pregúntale a Claude — sin gestionar claves de API.

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · **Español**

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## ¿Por qué askmd?

Si usas Claude Code a diario, tu carpeta `docs/` se llena rápido: notas de diseño, resúmenes de investigación, documentos de traspaso, síntesis de revisiones. El problema no es *escribirlos* — es *leerlos* después sin tener que abrir un editor pesado cada vez.

askmd llena ese hueco: **un visor exclusivamente de `.md` con navegación por directorios, más la capacidad de preguntarle a Claude sobre cualquier pasaje seleccionado** — reutilizando la autenticación de tu CLI `claude`, sin claves de API que gestionar.

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

**Combinación única de askmd**: exclusivo de `.md` + árbol de directorios + GUI ligera + Q&A con Claude CLI (sin gestión de claves).

## Filosofía de diseño

Cinco pilares que guían cada decisión:

1. **Instantáneo y ligero** — Tauri (Rust + WebView), sin bundler, renderizado cacheado en memoria. Objetivo: más ligero que Obsidian, para que nunca dudes en abrirlo.
2. **Teclado primero** — Navegación completa sin tocar el ratón. `↑↓` para explorar, `Enter` para abrir, `@` para filtrar, `Cmd+P` para cambiar, `Cmd+L` para preguntar.
3. **Solo `.md`** — Sin JSON, YAML, archivos de código ni directorios ocultos en el árbol. Una barrera de ruido deliberada que evita la expansión de funciones.
4. **Claude mediante CLI existente** — Sin clave de API, sin facturación adicional. El subproceso `claude -p` reutiliza tu suscripción Max/Pro. Una experiencia similar a "preguntar sobre la selección" de Cursor, local, dentro de tu plan actual.
5. **Visor, no editor** — Sin edición, barra de herramientas ni botón de guardar. Edita en VS Code/Neovim/Zed; askmd detecta los cambios y los refleja al instante.

## ¿Para quién es?

- Usuarios de Claude Code que ya tienen la CLI `claude` configurada
- Gente que acumula docenas o cientos de `.md` en `docs/`
- Lectores, no escritores (edita con tu editor favorito; askmd solo lee)

No es para: quien busca un *editor* de Markdown, quien necesita gestión de notas (backlinks, vista de grafo), o usuarios sin Claude Code.

## Características

- Árbol solo de `.md` (se omiten directorios ocultos como `.git`, `node_modules`, `.obsidian`; los directorios sin `.md` se colapsan)
- Renderizado con markdown-it + highlight.js + DOMPurify
- Navegación centrada en el teclado — ratón opcional
- Observación de archivos (`notify` crate): las ediciones en tu editor externo se reflejan al instante
- Extracción de front-matter → cabecera con título / fecha / etiquetas
- Navegación entre `.md` vía enlaces relativos; imágenes resueltas en el mismo directorio
- Búsqueda de texto completo en todos los archivos `.md` (`Cmd+F`)
- **Seleccionar → `Cmd+L` → respuesta de Claude en streaming en el panel derecho** (vía subproceso `claude -p`)

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `↑` `↓` / `j` `k` | Mover en el árbol |
| `Enter` | Abrir archivo |
| `@` | Filtro incremental |
| `Cmd+P` | Cambio rápido de archivo |
| `Cmd+F` | Búsqueda de texto completo |
| `Cmd+[` / `Cmd+]` | Atrás / adelante en historial |
| `Cmd+L` | Preguntar a Claude sobre el texto seleccionado |

## Instalación / Compilación

<!-- ### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
``` -->

Requisitos: toolchain de Rust, Node.js, CLI `claude` en el `PATH`.

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # modo desarrollo
npm run tauri:build    # build de release
```

Abre un directorio desde el diálogo, arrastra una carpeta a la ventana, o pásalo como argumento:

```sh
askmd ~/myrepo/docs
```

## Cómo funciona "Preguntar a Claude"

Selecciona texto en la vista renderizada y pulsa `Cmd+L`. askmd ejecuta `claude -p "<prompt con la selección>"` como subproceso y transmite la respuesta en streaming al panel derecho. Sin configurar claves de API, sin facturación aparte — tu suscripción existente de Claude Code hace el trabajo.

Próximamente: modo de paso a terminal (sesiones largas vía iTerm/Terminal) y soporte de deep-link para Claude Desktop.

## Hoja de ruta

Fase 1 (MVP, en curso): árbol, renderizado, navegación por teclado, observación de archivos, búsqueda de texto completo, Q&A en streaming con `Cmd+L`.

Fase 2+: búsqueda con tantivy, modo terminal, UI de directorios recientes, actualizador automático, distribución de releases.

## Apoyo

Si askmd te ahorra tiempo, puedes [invitarme a un café en Ko-fi](https://ko-fi.com/cyocun). Totalmente opcional — askmd es gratis, licencia MIT, y así seguirá.

## Licencia

MIT
