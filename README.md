# unictl

`unictl`은 Unity Editor를 CLI 기반 인터페이스로 제어하고 확장하는 standalone 도구입니다.

## 동작 방식

unictl은 **에디터 브리지(UPM 패키지)** + **CLI** 두 부분으로 구성됩니다.

```
┌─────────────────────┐         IPC          ┌──────────────────┐
│   Unity Editor      │◄───────────────────►│   CLI (bunx)     │
│                     │  Named Pipe (Win)    │                  │
│  com.unictl.editor  │  Unix Socket (Mac)   │  unictl health   │
│  (UPM 패키지)       │                      │  unictl list     │
└─────────────────────┘                      └──────────────────┘
```

**CLI만으로는 동작하지 않습니다.** Unity 프로젝트에 UPM 패키지를 먼저 설치하고, 에디터를 열어야 CLI가 연결됩니다.

## Quick Start

### 1. UPM 패키지 설치 (Unity 프로젝트 측)

먼저 Unity 프로젝트에 에디터 브리지를 설치합니다.

#### 방법 A: CLI로 자동 설정 (권장)

```bash
# 인자 없이 실행 — repo URL 자동, CLI 버전 태그로 UPM 고정
bunx github:siren403/unictl#v0.1.1 init

# 변경 내용 미리 보기
bunx github:siren403/unictl#v0.1.1 init --dryRun
```

이 커맨드는 `Packages/manifest.json`에 `com.unictl.editor` 의존성을 자동으로 추가합니다.
`--repoUrl`은 불필요합니다 — CLI가 내장된 repository 정보를 사용합니다.

#### 방법 B: manifest.json 직접 편집

`Packages/manifest.json`의 `dependencies`에 추가:

```json
"com.unictl.editor": "https://github.com/siren403/unictl.git?path=/packages/upm/com.unictl.editor#v0.1.1"
```

#### 방법 C: 로컬 파일 경로 (개발용)

서브모듈이나 로컬 클론으로 개발할 때:

```json
"com.unictl.editor": "file:../tools/unictl/packages/upm/com.unictl.editor"
```

> **요구사항**: Unity 6000.0+, `com.unity.nuget.newtonsoft-json` 3.2.1+

### 2. Unity 에디터 열기

UPM 패키지 설치 후 Unity 에디터를 열면 IPC 서버가 자동으로 시작됩니다.
별도의 설정이나 초기화 코드는 필요 없습니다.

### 3. CLI로 연결 확인

```bash
bunx github:siren403/unictl#v0.1.1 health --project /path/to/unity/project
```

`{"status":"ok","handler_registered":true}` 응답이 오면 준비 완료입니다.

### 4. 사용

```bash
bunx github:siren403/unictl#v0.1.1 list                                # 등록된 도구 목록
bunx github:siren403/unictl#v0.1.1 editor_control -p action=compile    # 컴파일 트리거
bunx github:siren403/unictl#v0.1.1 editor_control -p action=status     # 에디터 상태
bunx github:siren403/unictl#v0.1.1 editor_control -p action=play       # 플레이 모드
bunx github:siren403/unictl#v0.1.1 editor_control -p action=refresh    # AssetDatabase 리프레시
```

> **Tip**: npm에 퍼블리시된 경우 `bunx unictl`로 더 짧게 실행할 수 있습니다.

## 버전 관리

### 태그 고정 (권장)

CLI와 UPM 패키지가 동일 버전에서 나오도록 **태그를 명시**하세요:

```bash
bunx github:siren403/unictl#v0.1.1 init
# CLI: v0.1.1 코드 실행
# UPM: #v0.1.1 태그 참조 → 동일 버전 보장
```

### HEAD 모드 (개발/테스트용)

태그 없이 최신 커밋을 사용하려면 `--head` 플래그를 추가합니다:

```bash
bunx github:siren403/unictl init --head
# CLI: HEAD (최신 커밋)
# UPM: HEAD (태그 없음) → CLI와 동일 시점
```

> **주의**: HEAD 모드는 CLI와 UPM이 동일 커밋을 참조하지만, 이후 커밋이 추가되면
> Unity가 패키지를 다시 resolve할 때 의도치 않게 버전이 바뀔 수 있습니다.
> 프로덕션 환경에서는 반드시 태그 고정을 사용하세요.

### init 옵션 요약

| 옵션 | 설명 |
|------|------|
| (기본) | CLI 버전 태그로 고정 (`#v0.1.1`) |
| `--head` | HEAD 참조 (태그 없음) |
| `--version 0.1.0` | 특정 버전 태그 (`#v0.1.0`) |
| `--repoUrl <url>` | repo URL 직접 지정 (보통 불필요) |
| `--dryRun` | 변경 내용 미리 보기 |
| `--force` | 기존 참조 덮어쓰기 |

## 구성

- root package: GitHub tag-pinned `bunx` 진입점
- `packages/cli`: CLI source
- `packages/upm/com.unictl.editor`: Unity UPM editor package
- `native/unictl_native`: Rust native bridge
- `integrations/`: Codex / Claude Code thin wrapper source

## 참고 문서

- 소비자 가이드: [docs/standalone/consumer-guide.md](docs/standalone/consumer-guide.md)
- 개발자 세팅: [docs/standalone/development-setup.md](docs/standalone/development-setup.md)
- 고정 스펙: [docs/standalone/standalone-0.1-spec.md](docs/standalone/standalone-0.1-spec.md)
