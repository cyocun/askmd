# askmd

> 조용하고 빠른 `.md` 전용 뷰어 + AI Q&A. Markdown 파일을 탐색하고, 구절을 선택해서, 바로 AI에게 질문하세요. Claude / GitHub Copilot / ChatGPT 지원.

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · **한국어** · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## 왜 askmd인가?

Markdown 파일은 어디서나 쌓입니다 — 설계 스펙, 회의록, 조사 요약, 인수인계 문서, 리뷰 정리. 문제는 *쓰는* 것이 아니라, *나중에 읽을 때* 매번 무거운 에디터를 띄워야 한다는 점입니다.

askmd는 이 틈을 채웁니다: **`.md` 전용 뷰어 + 디렉터리 탐색 + 선택 구절을 AI에게 질문**. API 키 관리 불필요 — 로컬에 설치된 CLI 도구를 직접 호출합니다.

### 기존 도구와의 비교

| 도구 | askmd가 해결하는 한계 |
|---|---|
| VS Code Markdown Preview | 코드와 혼재; 조용한 읽기 모드 없음 |
| Obsidian | 무거움; 읽기만 할 때 Vault/플러그인이 과도함 |
| Typora | 유료; 에디터 중심으로 뷰어에 부적합 |
| MarkView | 단일 파일 뷰어; 디렉터리 트리 없음 |
| markdown-explorer | 컨셉 일치하나 2018년에 중단 (Electron) |
| Ferrite | 가볍지만 `.md` 전용이 아닌 편집기 |
| MDChat | CLI 전용; GUI나 디렉터리 탐색 없음 |

**askmd의 고유한 조합**: `.md` 전용 + 디렉터리 트리 + 경량 GUI + AI Q&A (키 관리 불필요).

## 설계 철학

모든 결정을 지탱하는 다섯 기둥:

1. **극도의 가벼움** — Tauri (Rust + WebView), 번들러 없음, 렌더링 결과 메모리 캐시. 목표: Obsidian보다 가벼워서 열기를 망설이지 않는 것.
2. **키보드 우선** — 마우스 없이 완결. `↑↓` 탐색, `Enter` 열기, `@` 필터, `Cmd+P` 전환, `Cmd+L` 질문.
3. **`.md`만** — 트리에 JSON, YAML, 코드 파일, 숨김 디렉터리를 표시하지 않음. 기능 비대화를 막는 의도적 노이즈 차단.
4. **AI는 기존 CLI 활용** — API 키 불필요, 추가 결제 없음. 로컬에 설치된 CLI (`claude`, `gh copilot`, `chatgpt`)를 서브프로세스로 호출. CLI가 없어도 독립 뷰어로 동작.
5. **뷰어이지 에디터가 아님** — 편집 기능, 도구 모음, 저장 버튼 없음. VS Code/Neovim/Zed에서 편집하면 askmd가 변경 사항을 즉시 반영.

## 누구를 위한 도구인가?

- `.md` 파일이 쌓여 있고 빠르고 집중해서 읽고 싶은 사람
- Markdown으로 문서를 공유하는 팀 — 디자이너, PM, 엔지니어 모두
- 읽으면서 AI에게 바로 질문하고 싶은 사람

AI CLI가 설치되어 있지 않아도 askmd는 디렉터리 트리, 키보드 내비게이션, 전체 텍스트 검색, 파일 감시를 갖춘 경량 `.md` 뷰어로 사용할 수 있습니다.

## 기능

- `.md` 전용 트리 (`.git`, `node_modules`, `.obsidian` 등 숨김 디렉터리는 건너뜀; `.md`가 없는 디렉터리는 접혀서 사라짐)
- 렌더링: markdown-it + highlight.js + DOMPurify
- Mermaid 다이어그램 + KaTeX 수식 렌더링
- 키보드 우선 — 마우스는 선택사항
- 파일 감시 (`notify` crate): 외부 에디터에서 저장하면 즉시 반영
- Front-matter 추출 → 제목 / 날짜 / 태그를 헤더에 표시
- `.md` 간 상대 경로 링크 이동; 이미지는 같은 디렉터리 기준
- 전체 텍스트 검색: 모든 `.md` 파일을 횡단 검색 (`Cmd+F`)
- 테마 시스템 (GitHub Light/Dark, Solarized Light/Dark)
- **선택 → `Cmd+L` → 오른쪽 패널에 AI 답변 스트리밍** (CLI 서브프로세스 경유)

## 키보드 단축키

| 키 | 동작 |
|---|---|
| `↑` `↓` / `j` `k` | 트리 이동 |
| `Enter` | 파일 열기 |
| `@` | 점진적 필터 |
| `Cmd+P` | 빠른 파일 전환 |
| `Cmd+F` | 전체 텍스트 횡단 검색 |
| `Cmd+[` / `Cmd+]` | 히스토리 뒤로 / 앞으로 |
| `Cmd+L` | 선택 구절을 AI에게 질문 |

## 설치 / 빌드

<!-- ### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
``` -->

요구사항: Rust 툴체인, Node.js.

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # 개발 모드
npm run tauri:build    # 릴리스 빌드
```

다이얼로그로 디렉터리를 열거나, 폴더를 창에 드롭하거나, 인자로 전달:

```sh
askmd ~/my-notes
```

## "AI에게 질문" 작동 방식

렌더링된 뷰에서 텍스트를 선택하고 `Cmd+L`을 누르세요. askmd가 시스템에서 사용 가능한 AI CLI 도구를 감지하고, 오른쪽 상단 메뉴에서 프로바이더를 선택할 수 있습니다. 답변은 오른쪽 패널에 스트리밍됩니다.

지원 프로바이더:

| 프로바이더 | CLI 명령어 | 스트리밍 |
|---|---|---|
| **Claude** | `claude` | 구조화된 JSON 스트리밍 (도구 사용 지원) |
| **GitHub Copilot** | `gh copilot` | 플레인 텍스트 |
| **ChatGPT** | `chatgpt` | 플레인 텍스트 |

여러 CLI가 설치되어 있으면 메뉴에서 전환 가능. 아무것도 설치되지 않으면 AI 기능은 숨겨지고 순수 뷰어로 동작합니다.

## AI CLI 설정 가이드

AI Q&A 기능을 사용하려면 CLI 도구가 하나 이상 필요합니다.

### Claude (추천)

Claude CLI는 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)의 일부입니다. Claude Pro / Max / Team 플랜 필요.

```sh
# npm으로 설치
npm install -g @anthropic-ai/claude-code

# 최초 설정 — 브라우저가 열려 인증
claude
```

인증이 완료되면 `claude` 명령어를 사용할 수 있습니다. API 키 불필요 — askmd가 직접 호출합니다.

### GitHub Copilot

Copilot은 [GitHub CLI](https://cli.github.com/)를 통해 동작합니다. GitHub Copilot 구독 필요 (무료 티어 있음).

```sh
# macOS
brew install gh

# Windows
winget install GitHub.cli

# 인증 후 Copilot 확장 설치
gh auth login
gh extension install github/gh-copilot
```

터미널에서 `gh copilot`이 작동하면 askmd가 자동 감지합니다.

### ChatGPT

커뮤니티 제작 [chatgpt-cli](https://github.com/kardolus/chatgpt-cli)를 사용합니다. OpenAI API 키 필요.

```sh
# macOS
brew tap kardolus/chatgpt-cli
brew install chatgpt-cli

# API 키 설정
export OPENAI_API_KEY="sk-..."
```

터미널에서 `chatgpt` 명령어가 작동하면 askmd가 자동 감지합니다.

---

**CLI가 설치되어 있지 않나요?** 괜찮습니다 — askmd는 빠르고 키보드 중심의 `.md` 뷰어로 그대로 사용 가능합니다. 언제든 CLI를 설치하면 다음 실행 시 AI 기능이 자동으로 나타납니다.

## 로드맵

Phase 2+: 터미널 직통 모드, 경량 편집, 분할 뷰, Homebrew Cask 배포.

## 후원

askmd가 시간을 아껴줬다면 [Ko-fi에서 커피 한 잔](https://ko-fi.com/cyocun) 사주셔도 좋습니다. 완전히 선택사항이며 — askmd는 무료, MIT 라이선스로 유지됩니다.

## 라이선스

MIT
