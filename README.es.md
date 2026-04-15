# askmd

> Un visor silencioso y rápido enfocado solo en `.md`, pensado para usuarios de Claude Code. Navega tus documentos, selecciona un pasaje y pregúntale a Claude — sin gestionar claves de API.

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · [한국어](README.ko.md) · **Español**

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## ¿Por qué askmd?

Si usas Claude Code a diario, tu carpeta `docs/` se llena rápido: notas de diseño, resúmenes de investigación, documentos de traspaso, síntesis de revisiones. El problema no es *escribirlos* — es *leerlos* después sin tener que abrir un editor pesado cada vez.

- **VS Code Markdown Preview** mezcla los documentos con ruido del código
- **Obsidian** es potente pero pesado, con Vault y plugins que no necesitas solo para *leer*
- **Typora** es de pago y está orientado a la edición
- **markdown-explorer** tenía la idea correcta pero se detuvo en 2018
- **Ferrite** es ligero pero edita todo tipo de archivos, no solo `.md`

askmd llena ese hueco: **un visor exclusivamente de `.md` con navegación por directorios, más la capacidad de preguntarle a Claude sobre cualquier pasaje seleccionado** — reutilizando la autenticación de tu CLI `claude`, sin claves de API que gestionar.

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
- **Seleccionar → `Cmd+L` → respuesta de Claude en el panel derecho** (vía subproceso `claude -p`)

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `↑` `↓` / `j` `k` | Mover en el árbol |
| `Enter` | Abrir archivo |
| `/` | Filtro incremental |
| `Cmd+P` | Cambio rápido de archivo |
| `Cmd+[` / `Cmd+]` | Atrás / adelante en historial |
| `Cmd+L` | Preguntar a Claude sobre el texto seleccionado |

## Instalación / Compilación

Requisitos: toolchain de Rust, Node.js, CLI `claude` en el `PATH`.

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # modo desarrollo
npm run tauri:build    # build de release
```

Abre un directorio desde el diálogo o pásalo como argumento:

```sh
askmd ~/myrepo/docs
```

## Cómo funciona "Preguntar a Claude"

Selecciona texto en la vista renderizada y pulsa `Cmd+L`. askmd ejecuta `claude -p "<prompt con la selección>"` como subproceso y transmite la respuesta al panel derecho. Sin configurar claves de API, sin facturación aparte — tu suscripción existente de Claude Code hace el trabajo.

Próximamente: modo de paso a terminal (sesiones largas vía iTerm/Terminal) y soporte de deep-link para Claude Desktop.

## Hoja de ruta

Fase 1 (MVP, en curso): árbol, renderizado, navegación por teclado, observación de archivos, Q&A en línea con `Cmd+L`.

Fase 2+: búsqueda de texto completo (tantivy), modo terminal, UI de directorios recientes, actualizador automático, distribución de releases.

Contexto, filosofía de diseño y tabla completa de comparación en [docs/CONCEPT.md](docs/CONCEPT.md).

## Apoyo

Si askmd te ahorra tiempo, puedes [invitarme a un café en Ko-fi](https://ko-fi.com/cyocun). Totalmente opcional — askmd es gratis, licencia MIT, y así seguirá.

## Licencia

MIT
