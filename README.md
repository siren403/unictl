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
# Bun이 설치되어 있으면 바로 실행 가능
bunx github:siren403/unictl init --repo-url https://github.com/siren403/unictl.git

# 변경 내용 미리 보기
bunx github:siren403/unictl init --repo-url https://github.com/siren403/unictl.git --dry-run
```

이 커맨드는 `Packages/manifest.json`에 `com.unictl.editor` 의존성을 자동으로 추가합니다.

#### 방법 B: manifest.json 직접 편집

`Packages/manifest.json`의 `dependencies`에 추가:

```json
"com.unictl.editor": "https://github.com/siren403/unictl.git?path=packages/upm/com.unictl.editor"
```

버전을 고정하려면 태그를 지정:

```json
"com.unictl.editor": "https://github.com/siren403/unictl.git?path=packages/upm/com.unictl.editor#v0.1.0"
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
# 에디터 연결 확인
bunx github:siren403/unictl health --project /path/to/unity/project
```

`{"status":"ok","handler_registered":true}` 응답이 오면 준비 완료입니다.

### 4. 사용

```bash
bunx github:siren403/unictl list                                # 등록된 도구 목록
bunx github:siren403/unictl editor_control -p action=compile    # 컴파일 트리거
bunx github:siren403/unictl editor_control -p action=status     # 에디터 상태
bunx github:siren403/unictl editor_control -p action=play       # 플레이 모드
bunx github:siren403/unictl editor_control -p action=refresh    # AssetDatabase 리프레시
```

> **Tip**: npm에 퍼블리시된 경우 `bunx unictl`로 더 짧게 실행할 수 있습니다.

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
