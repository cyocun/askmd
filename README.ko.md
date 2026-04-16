# askmd

> Claude Code 사용자를 위한, 조용하고 빠른 `.md` 전용 뷰어. 문서를 탐색하고, 구절을 선택해서, 바로 Claude에게 질문하세요 — API 키 관리 없이.

[English](README.md) · [日本語](README.ja.md) · [简体中文](README.zh-CN.md) · **한국어** · [Español](README.es.md)

[![ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/cyocun)

---

## 왜 askmd인가?

Claude Code를 매일 사용하다 보면 `docs/` 폴더가 금방 쌓입니다 — 설계 메모, 조사 요약, 인수인계 문서, 리뷰 정리. 문제는 *쓰는* 것이 아니라, *나중에 읽을 때* 매번 무거운 에디터를 띄워야 한다는 점입니다.

askmd는 이 틈을 채웁니다: **`.md` 전용 뷰어 + 디렉터리 탐색 + 선택 구절을 Claude에게 질문**. 기존 `claude` CLI 인증을 그대로 활용하므로 API 키 관리도, 중복 결제도 없습니다.

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

**askmd의 고유한 조합**: `.md` 전용 + 디렉터리 트리 + 경량 GUI + Claude CLI Q&A (키 관리 불필요).

## 설계 철학

모든 결정을 지탱하는 다섯 기둥:

1. **극도의 가벼움** — Tauri (Rust + WebView), 번들러 없음, 렌더링 결과 메모리 캐시. 목표: Obsidian보다 가벼워서 열기를 망설이지 않는 것.
2. **키보드 우선** — 마우스 없이 완결. `↑↓` 탐색, `Enter` 열기, `@` 필터, `Cmd+P` 전환, `Cmd+L` 질문.
3. **`.md`만** — 트리에 JSON, YAML, 코드 파일, 숨김 디렉터리를 표시하지 않음. 기능 비대화를 막는 의도적 노이즈 차단.
4. **Claude는 기존 CLI 활용** — API 키 불필요, 추가 결제 없음. `claude -p` 서브프로세스로 Max/Pro 구독 그대로 사용. Cursor의 "선택 영역 질문"과 유사한 경험을, 로컬에서, 기존 플랜으로.
5. **뷰어이지 에디터가 아님** — 편집 기능, 도구 모음, 저장 버튼 없음. VS Code/Neovim/Zed에서 편집하면 askmd가 변경 사항을 즉시 반영.

## 누구를 위한 도구인가?

- `claude` CLI를 이미 설정한 Claude Code 사용자
- `docs/`에 수십 ~ 수백 개의 `.md`를 쌓아둔 사람
- 읽는 사람, 쓰는 사람이 아님 (쓰기는 좋아하는 에디터로; askmd는 읽기 전용)

대상이 아닌 사람: Markdown *에디터*를 원하는 사람, 노트 관리 기능(백링크, 그래프 뷰)이 필요한 사람, Claude Code를 쓰지 않는 사람.

## 기능

- `.md` 전용 트리 (`.git`, `node_modules`, `.obsidian` 등 숨김 디렉터리는 건너뜀; `.md`가 없는 디렉터리는 접혀서 사라짐)
- 렌더링: markdown-it + highlight.js + DOMPurify
- 키보드 우선 — 마우스는 선택사항
- 파일 감시 (`notify` crate): 외부 에디터에서 저장하면 즉시 반영
- Front-matter 추출 → 제목 / 날짜 / 태그를 헤더에 표시
- `.md` 간 상대 경로 링크 이동; 이미지는 같은 디렉터리 기준
- 전체 텍스트 검색: 모든 `.md` 파일을 횡단 검색 (`Cmd+F`)
- **선택 → `Cmd+L` → 오른쪽 패널에 Claude 답변 스트리밍** (`claude -p` 서브프로세스 경유)

## 키보드 단축키

| 키 | 동작 |
|---|---|
| `↑` `↓` / `j` `k` | 트리 이동 |
| `Enter` | 파일 열기 |
| `@` | 점진적 필터 |
| `Cmd+P` | 빠른 파일 전환 |
| `Cmd+F` | 전체 텍스트 횡단 검색 |
| `Cmd+[` / `Cmd+]` | 히스토리 뒤로 / 앞으로 |
| `Cmd+L` | 선택 구절을 Claude에게 질문 |

## 설치 / 빌드

### Homebrew (macOS)

```sh
brew install --cask cyocun/tap/askmd
```

### 소스에서 빌드

요구사항: Rust 툴체인, Node.js, `PATH`에 `claude` CLI.

```sh
git clone https://github.com/cyocun/askmd.git
cd askmd
npm install
npm run tauri:dev      # 개발 모드
npm run tauri:build    # 릴리스 빌드
```

다이얼로그로 디렉터리를 열거나, 폴더를 창에 드롭하거나, 인자로 전달:

```sh
askmd ~/myrepo/docs
```

## "Claude에게 질문" 작동 방식

렌더링된 뷰에서 텍스트를 선택하고 `Cmd+L`을 누르면, askmd가 `claude -p "<선택 구절을 포함한 프롬프트>"`를 서브프로세스로 실행해 답변을 오른쪽 패널에 스트리밍합니다. API 키 설정도, 별도 결제도 필요 없습니다 — 기존 Claude Code 구독이 그대로 동작합니다.

향후: 터미널 연계 모드 (iTerm/Terminal로 장시간 대화), Claude Desktop 딥링크 지원 검토 중.

## 로드맵

Phase 1 (MVP, 진행 중): 트리, 렌더링, 키보드 내비게이션, 파일 감시, 전체 텍스트 검색, 스트리밍 `Cmd+L` Q&A.

Phase 2+: tantivy 기반 검색, 터미널 모드, 최근 디렉터리 UI, 자동 업데이트, 릴리스 배포.

## 후원

askmd가 시간을 아껴줬다면 [Ko-fi에서 커피 한 잔](https://ko-fi.com/cyocun) 사주셔도 좋습니다. 완전히 선택사항이며 — askmd는 무료, MIT 라이선스로 유지됩니다.

## 라이선스

MIT
