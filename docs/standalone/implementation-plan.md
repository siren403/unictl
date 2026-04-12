# unictl 단독배포 구현 계획

이 문서는 `unictl`의 단독배포를 위한 구현 계획만 다룬다.

배경 설명, 퍼즐 프로젝트 의존성, 실험 기록은 기존 [PLAN.md](embedded-plan.md)에 남기고, 이 문서는 제품화와 배포 단위 정의에만 집중한다.

`0.1.x`에서 구현자가 바로 따라야 할 고정 계약은 [STANDALONE_0_1_SPEC.md](standalone-0.1-spec.md)에 둔다.

실제 작업 분해와 착수 순서는 [IMPLEMENTATION_BACKLOG.md](implementation-backlog.md)에 둔다.

소비자 관점의 설치/사용 흐름은 [CONSUMER_GUIDE.md](consumer-guide.md)에 둔다.

`unictl` 자체를 개발하는 사람을 위한 환경 세팅과 로컬 검증 루프는 [DEVELOPMENT_SETUP.md](development-setup.md)에 둔다.

중요:

- `0.1.x`의 canonical release root는 Queenzle 저장소 루트가 아니라 별도 `unictl` 저장소 루트다.
- 현재 Queenzle 내부의 `unictl/`, `Packages/upm/com.unictl.core`, `dist/`, 루트 `package.json`은 제품화 전 feasibility 검증용 임베디드 프로토타입이다.
- Queenzle는 `0.1.x` 동안 dogfooding 소비자 프로젝트로만 취급한다.

## 1. 목표 산출물

단일 저장소에서 아래 산출물을 함께 버전 관리하고 함께 릴리스한다.

1. `CLI`
   - 사용자 진입점은 기본적으로 `bunx github:OWNER/REPO#vX.Y.Z ...`
   - 소스 오브 트루스와 릴리스 허브는 GitHub 저장소

2. `UPM 패키지`
   - 패키지명: `com.unictl.core`
   - 포함 범위:
     - `[UnictlTool]`
     - 기본 제공 `UnictlTool`
     - 에디터 서버/라우터
     - 플랫폼별 네이티브 플러그인

3. `Codex 플러그인`
   - `unictl` 설치, 사용, 워크플로우 안내용 플러그인
   - Codex에서 `unictl` 기반 Unity 에디터 작업을 쉽게 시작할 수 있게 함

4. `Claude Code 지원 패키지`
   - Claude Code에서 `unictl` 설치/사용 흐름을 바로 연결할 수 있는 규칙, 에이전트, 설정 템플릿

5. `GitHub 릴리스 자산`
   - 플랫폼별 네이티브 바이너리
   - UPM 배포용 산출물
   - 설치/마이그레이션 문서

## 2. 제품 방향

### 확정 방향

- `unictl`은 특정 게임 런타임 기능이 아니라 Unity Editor를 CLI 기반 인터페이스로 제어하고 확장하는 도구다.
- 프로젝트별 게임 로직은 `unictl`의 소비자이며, `unictl`의 일부가 아니다.
- 에디터 제어 계층과 에이전트 지원 자산을 모두 같은 저장소에서 릴리스한다.

### 배포 원칙

1. `CLI`는 stateless하게 유지한다.
2. `Unity 쪽 핵심 기능`은 UPM 설치만으로 들어오게 한다.
3. `네이티브 플러그인`은 UPM 패키지 내부에 플랫폼별로 동봉한다.
4. `Codex/Claude 지원 자산`은 선택 설치지만 같은 버전 계열로 같이 배포한다.
5. GitHub 태그 하나로 CLI, UPM, 플러그인 지원 자산을 함께 릴리스한다.

### 0.1 비목표

`0.1.x`에서 하지 않는 일:

- Linux Unity Editor 지원
- 다중 에디터 인스턴스 동시 제어
- Windows named pipe 전송 계층
- 별도 Unity package registry 운영
- 에이전트 통합 자산의 독립 버전 운영
- 런타임 플레이어 제어 기능 추가

## 3. 배포 단위

### 3.1 CLI

목표 UX:

```bash
bunx github:OWNER/REPO#vX.Y.Z health
bunx github:OWNER/REPO#vX.Y.Z list
bunx github:OWNER/REPO#vX.Y.Z editor open
```

정책:

- 사용자 문서는 기본적으로 tag-pinned GitHub 실행 기준으로 작성한다.
- GitHub는 canonical source, canonical tag, canonical release ledger 역할을 맡는다.
- `0.1.x`의 1차 배포 경로는 GitHub direct bunx다.
- 즉, GitHub가 정본이자 실행 source다.
- CLI는 UPM 패키지 버전과 동일한 semver를 사용한다.
- release tag 형식은 항상 `vX.Y.Z`다.
- CLI 패키지는 TypeScript 소스를 직접 bin으로 노출하지 않고, 빌드된 `dist/` 엔트리만 bin에 연결한다.
- mono-repo에서도 GitHub direct bunx를 유지하기 위해 저장소 루트 `package.json`은 `unictl` bin을 노출하는 executable shim 역할을 맡는다.
- `packages/cli/`는 실제 소스 위치이고, 루트 package는 published executable surface다.
- `bunx unictl ...`처럼 package name만으로 실행하는 짧은 경로는 `0.1.x` 필수 범위가 아니다.

구현 포인트:

- 현재 `unictl/package.json`, `src/cli.ts`, `src/client.ts`, `src/socket.ts`, `src/editor.ts`를 독립 배포 단위로 정리한다.
- 로컬 프로젝트 경로 탐색과 Unity 실행 파일 탐색을 플랫폼별 전략으로 분리한다.
- CLI는 transport 구현과 endpoint discovery만 담당하며, editor 내 구현 세부를 알지 않는다.
- GitHub direct bunx는 workspace 내부 package를 고르는 방식에 기대지 않고, 저장소 루트 executable surface만을 기준으로 성립시킨다.
- 따라서 `0.1.x`에서는 반드시 루트 `package.json`이 `unictl` bin을 직접 노출해야 한다.
- `editor open`의 editor 경로 해석 우선순위는 정확히 아래 순서를 따른다.
  1. `UNITY_EDITOR_PATH`
  2. `--editor-path`
  3. Unity Hub 설치 경로 탐지
  4. `ProjectSettings/ProjectVersion.txt` 기반 버전 추론

#### 루트 shim 계약

루트 package는 실행 표면만 담당한다.

역할:

- `bunx github:OWNER/REPO#vX.Y.Z ...` 실행 시 Bun이 해석할 package entry 제공
- 실제 CLI 구현 산출물 `dist/`를 노출
- workspace 구성과 공통 release metadata를 제공

루트 package가 하지 않는 일:

- transport 구현 로직 소유
- editor control 로직 소유
- native build 로직 소유

권장 파일 구조:

```text
repo/
├── package.json
├── bunfig.toml
├── dist/
│   └── unictl.js
├── packages/
│   └── cli/
│       ├── package.json
│       └── src/
│           ├── cli.ts
│           ├── client.ts
│           ├── socket.ts
│           └── editor.ts
```

루트 `package.json` 계약:

```json
{
  "name": "unictl-monorepo",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "integrations/*"
  ],
  "bin": {
    "unictl": "./dist/unictl.js"
  }
}
```

`packages/cli/package.json` 계약:

```json
{
  "name": "@unictl/cli-src",
  "private": true,
  "type": "module"
}
```

빌드 규칙:

- 실제 소스는 `packages/cli/src/*`에 둔다.
- 릴리스 전 build step이 `packages/cli/src/cli.ts`를 루트 `dist/unictl.js`로 번들 또는 compile한다.
- 루트 `bin.unictl`은 항상 `dist/unictl.js`만 가리킨다.
- GitHub direct bunx smoke는 루트 `bin`만 검증한다.

### 3.2 UPM 패키지

패키지명:

- `com.unictl.core`

포함 범위:

- `Editor/Unictl/`
  - `UnictlToolAttribute`
  - `ToolRouter`
  - `UnictlServer`
  - `UnictlNative`
  - 기본 제공 built-in tools
- `Plugins/`
  - macOS용 네이티브 플러그인
  - Windows용 네이티브 플러그인

설치 결과:

- Unity 프로젝트는 `manifest.json`에 UPM 의존성만 추가하면 기본 `unictl` 서버와 built-in tools를 갖게 된다.
- 프로젝트 고유 커맨드는 소비자 프로젝트가 자체적으로 `[UnictlTool]` 클래스를 추가해 확장한다.
- `0.1.x`에서는 별도 Unity registry를 만들지 않는다.
- 기본 설치 방식은 Git URL 또는 릴리스 tarball이다.
- Git URL 설치 문법은 아래 형태로 고정한다.

```json
{
  "dependencies": {
    "com.unictl.core": "REPO_GIT_URL.git?path=/packages/upm/com.unictl.core#vX.Y.Z"
  }
}
```

- UPM 패키지는 자체 의존성을 스스로 선언하며, fresh Unity 프로젝트에 단독 설치 가능해야 한다.

#### 3.2.1 `0.1.x` 기본 내장 `UnictlTool`

`0.1.x`의 public core contract는 아래 4개를 기준으로 고정한다.

1. `ping`
   - 연결 확인과 서버 라우팅 sanity check용
   - `health`, `doctor`, 초기 설치 검증의 기준 명령

2. `editor_control`
   - public contract에 포함하는 action은 `play`, `stop`, `refresh`, `compile`, `restart`, `status`, `quit`, `load_scene`
   - 에디터 제어의 기본 표면이며 필수 내장 명령

3. `capture_ui`
   - Game view와 UI Toolkit overlay를 함께 캡처
   - 에이전트 기반 UI 검증과 시각 회귀 확인의 기본 수단

4. `ui_toolkit_input`
   - 런타임 UI Toolkit 트리 inspect
   - selector 기반 `click`, `set_value`, `scroll`
   - 에이전트 기반 UI 상호작용의 기본 수단

별도 진단 범위:

- `profiler_frame_dump`는 현재 임베디드 프로토타입에는 존재하지만, `0.1.x` core public contract에는 고정하지 않는다.
- `automation_*`, `run_playmode_tests`, `playmode_test_status`, `cancel_playmode_test_run`도 현재 코드에 존재하더라도 `0.1.x` core contract에는 포함하지 않는다.
- 위 진단/자동화 계열은 후속 `diagnostics` add-on 또는 소비자 프로젝트 확장 명령으로 재배치한다.

원칙:

- 위 4개 이름과 `editor_control`의 stable action 집합만 `0.1.x`의 built-in command contract로 간주한다.
- 소비자 프로젝트 고유 명령은 이 목록에 넣지 않고, 별도 `[UnictlTool]` 클래스로 확장한다.
- built-in tool 추가는 가능하지만, 위 core contract의 제거/개명은 호환성 변경으로 취급한다.

### 3.3 Codex 플러그인

역할:

- `unictl` 설치 및 진단 워크플로우를 Codex 안에 노출
- Unity 에디터 제어 관련 프롬프트/스킬/가이드 제공
- 프로젝트에 `unictl`이 없을 때 설치 유도

배포 형태:

- 저장소 내 독립 디렉터리
- Codex 플러그인 메타데이터와 스킬/앱 자산 포함

최소 범위:

- 설치 가이드
- `health`, `list`, `editor open/status/restart`, `doctor` 흐름
- Unity 작업용 기본 워크플로우 문서
- `.codex/` 안의 에이전트/스킬/앱 자산은 thin wrapper만 둔다.
- 실제 공통 문서 원문은 `docs/standalone/`에만 둔다.

### 3.4 Claude Code 지원 패키지

역할:

- Claude Code에서 `unictl` 기반 Unity 작업을 쉽게 시작하도록 규칙/에이전트/설정 템플릿 제공

배포 형태:

- 저장소 내 독립 디렉터리
- `.claude/agents`, `.claude/rules`, 설정 예시 파일, 설치 스크립트 포함

최소 범위:

- Unity 프로젝트 감지
- `unictl` 설치/연결 확인
- Play/Edit mode 전환 규칙
- UI smoke, capture, compile, doctor 가이드
- `.claude/` 안의 자산은 tool-specific wrapper와 설정 예시만 두고, 중복 문서는 생성물로 취급한다.

## 4. 단일 저장소 구조

이 섹션의 `repo/`는 Queenzle 저장소가 아니라 별도 `unictl` 저장소 루트를 뜻한다.

영구 목표 구조:

```text
repo/
├── package.json               # root executable shim for GitHub+bunx
├── packages/
│   ├── cli/                    # bunx 진입점
│   └── upm/com.unictl.core/    # UPM 패키지
├── native/
│   └── unictl_native/          # Rust crate + platform build scripts
├── integrations/
│   ├── codex/                  # Codex plugin package
│   └── claude-code/            # Claude Code support package
├── scripts/
│   ├── build/
│   └── release/
├── docs/
│   └── standalone/
└── VERSION
```

마이그레이션 기준:

- 현재 `unictl/` 아래의 CLI, native, Unity 파일은 위 구조로 단계적으로 분리한다.
- 분리 전까지는 현재 경로를 유지하되, 새 구조를 목표로 스크립트와 문서를 맞춘다.
- 기존 Queenzle 프로젝트는 제품화 완료 전까지 dogfooding 소비자로 남긴다.
- 최종 mono-repo root는 저장소 루트다.
- 현재 `unictl/` 디렉터리는 transitional staging area로만 취급한다.
- 마이그레이션 순서는 정확히 아래를 따른다.
  1. 루트 `VERSION`과 릴리스 스캐폴딩 추가
  2. Rust native crate와 빌드 출력 경계 분리
  3. `Assets/Editor/Unictl`와 `Assets/Plugins/*`에서 UPM 패키지 추출
  4. CLI를 `packages/cli`로 분리
  5. Codex/Claude support pack 추가
  6. Queenzle 내부 legacy 복사본 제거

## 5. 버전 정책

정본:

- 루트 `VERSION` 파일이 모든 릴리스 버전의 단일 source of truth다.

동기화 대상:

- CLI `package.json`
- Rust `Cargo.toml`
- UPM `package.json`
- Codex plugin manifest
- Claude support pack manifest 또는 metadata file

규칙:

- Git tag는 항상 `vX.Y.Z`
- GitHub release, UPM package, Codex support pack, Claude support pack은 모두 같은 `X.Y.Z`를 사용
- 개별 파일에서 독립 버전 증가 금지
- `doctor`는 CLI/UPM/native/integration version drift를 오류로 보고한다

## 6. Windows 지원 계획

Windows 지원은 `0.1.x` 범위에서 반드시 포함한다.

실행 순서 메모:

- Windows 지원은 `0.1.x` 수용 기준에는 포함하지만, 현재 구현 플랜에서는 가장 마지막 phase로 배치한다.
- 즉, macOS 기준 transport, UPM, CLI, integration, release skeleton을 먼저 안정화한 뒤 Windows x64를 최종 플랫폼 확장 단계에서 붙인다.

### 6.1 지원 범위

초기 지원 범위:

- Unity Editor on Windows x64
- `unictl_native.dll`
- GitHub direct bunx 실행에서 Windows 프로젝트 탐지
- `editor open/status/quit/restart`
- `health`, `list`, `command` 호출

후속 범위:

- ARM64 Windows
- CI/headless Windows 검증
- Linux editor 지원

### 6.2 전송 계층 추상화

현재 구현은 Unix socket 전용에 가깝다.

Windows 지원을 위해 endpoint abstraction을 도입한다.

목표 계약:

- macOS: Unix domain socket
- Windows: loopback HTTP endpoint
- 공통 discovery 파일: `.unictl/endpoint.json`
- `.unictl/endpoint.json`은 CLI가 읽는 유일한 discovery artifact다.
- stale endpoint는 probe 실패 + pid 검사로 판정한다.
- endpoint 파일은 editor startup 시 atomic write, graceful quit 시 삭제를 원칙으로 한다.

예시:

```json
{
  "schema": 1,
  "transport": "unix",
  "path": "/path/to/.unictl/unictl.sock",
  "pid": 12345,
  "projectRoot": "/path/to/project"
}
```

```json
{
  "schema": 1,
  "transport": "tcp",
  "host": "127.0.0.1",
  "port": 42137,
  "token": "session-secret",
  "pid": 23456,
  "projectRoot": "C:/path/to/project"
}
```

구현 규칙:

- CLI는 직접 소켓 경로를 가정하지 않고 endpoint descriptor를 먼저 읽는다.
- Windows에서는 TCP + session token을 기본값으로 사용한다.
- 로컬 전용 바인딩과 session token 검증으로 외부 접근을 막는다.
- `GET /health`와 `POST /command`의 protocol shape는 플랫폼과 무관하게 동일하게 유지한다.
- `0.1.x`에서는 Windows named pipes, WebSocket, SSE transport를 도입하지 않는다.
- Windows에서는 모든 요청에 `X-Unictl-Token` 헤더를 요구한다.
- macOS `0.1.x`에서는 Unix socket 파일 권한을 보안 경계로 사용한다.

### 6.3 Windows용 Unity 실행 파일 탐지

현재 macOS 전용 경로 하드코딩을 제거하고 아래 우선순위를 도입한다.

1. `UNITY_EDITOR_PATH` 환경변수
2. `--editor-path` CLI 플래그
3. Unity Hub 설치 경로 탐지
4. 프로젝트의 `ProjectVersion.txt` 기반 기본 경로 추론

Windows 기본 후보:

- `%ProgramFiles%/Unity/Hub/Editor/<version>/Editor/Unity.exe`

open/quit/status 정책:

- `editor status`, `editor quit`, `editor restart`는 endpoint file을 1차 truth로 본다.
- process scan은 stale endpoint 복구를 위한 fallback으로만 사용한다.
- `editor open`은 live endpoint가 있으면 실패해야 한다.
- endpoint 파일은 있으나 응답이 없으면 stale로 간주하고 덮어쓴다.

### 6.4 Windows 네이티브 플러그인 패키징

UPM 패키지 안에 아래를 포함한다.

- `Plugins/macOS/unictl_native.bundle`
- `Plugins/Windows/x86_64/unictl_native.dll`

검증 항목:

- Unity Editor 로드 성공
- `[DllImport("unictl_native")]` 호출 성공
- Domain Reload 이후 상태 유지
- editor open/quit/restart 흐름 정상
- `unictl_ping()` 반환값 검증

### 6.5 Windows 0.1 수용 테스트

필수 smoke gate:

1. fresh project + editor not running 상태에서 `bunx github:OWNER/REPO#vX.Y.Z editor status --project <path>`가 `running=false`를 반환
2. `bunx github:OWNER/REPO#vX.Y.Z editor open --project <path> --editor-path <Unity.exe>` 실행 후 `.unictl/endpoint.json`이 생성
3. 생성된 endpoint는 `transport=tcp`, `host=127.0.0.1`, non-empty `token`, valid `pid`를 가진다
4. `bunx github:OWNER/REPO#vX.Y.Z health --project <path>` 성공
5. `bunx github:OWNER/REPO#vX.Y.Z list --project <path>` 성공
6. token 없는 직접 요청은 `401` 또는 `403` 반환
7. `bunx github:OWNER/REPO#vX.Y.Z editor quit --project <path>` 후 endpoint가 무효화
8. `bunx github:OWNER/REPO#vX.Y.Z editor restart --project <path>` 후 새 `pid`와 새 `token`이 발급
9. C# assembly reload 후에도 같은 세션에서 `health`와 `list`가 계속 성공

## 7. 패키징 계획

### 7.1 CLI 패키징

요구사항:

- `bunx github:OWNER/REPO#vX.Y.Z`가 기본 진입점
- GitHub 태그 릴리스와 버전 정렬
- 버전 정보는 `VERSION` 파일과 동기화

작업 항목:

- CLI 배포용 workspace 분리
- 버전 주입 스크립트
- `unictl version` 명령 추가
- `doctor`에서 CLI 버전과 UPM 버전 일치 검사
- `dist/` 산출물 생성
- GitHub direct bunx용 root executable shim 검증
- release asset용 `release-manifest.json` 생성
- release asset용 `SHA256SUMS` 생성

### 7.2 UPM 패키징

요구사항:

- `manifest.json`에 추가 가능한 정식 UPM 패키지 구조
- 기본 built-in tools 포함
- 플랫폼별 네이티브 바이너리 포함

작업 항목:

- `package.json` for UPM
- asmdef 정리
- meta 파일 안정화
- 샘플 설치 가이드
- `unictl init`에서 manifest 추가 지원
- `com.unity.nuget.newtonsoft-json` 등 필요한 의존성 명시
- tarball 설치 검증
- Git URL `?path=` 설치 검증

### 7.3 Codex 플러그인 패키징

요구사항:

- `.codex-plugin/plugin.json`
- 필요한 skills/apps/assets 포함
- `unictl` 설치와 Unity editor workflow를 연결
- Codex integration은 독립 packaging surface이지만 독립 source of truth가 아니다

작업 항목:

- generic Unity + unictl skill 작성
- plugin manifest 작성
- 설치 후 첫 실행 안내 프롬프트 정의
- 버전 잠금 방식 정의
- release artifact 이름 고정: `codex-plugin-X.Y.Z.zip`
- 공통 문서 원문은 `docs/standalone/`에서 생성

### 7.4 Claude Code 지원 패키징

요구사항:

- `.claude/agents`
- `.claude/rules`
- 설정 예시
- 설치 스크립트 또는 복사 템플릿
- Claude integration도 독립 packaging surface이지만 독립 source of truth가 아니다

작업 항목:

- `unictl`용 공통 rule pack 작성
- smoke/capture/doctor용 agent 템플릿 작성
- Codex 자산과 중복되는 내용은 공통 문서로 분리
- release artifact 이름 고정: `claude-code-support-X.Y.Z.zip`
- install/update는 tagged artifact 기준 copy or unpack flow로 자동화

## 8. 설치 및 업데이트 흐름

### 8.1 Unity 프로젝트

설치:

- `bunx github:OWNER/REPO#vX.Y.Z init`가 `manifest.json`에 `com.unictl.core` Git URL 항목을 추가 또는 갱신한다.
- fresh project 기준으로 추가 설정 없이 built-in tools가 로드되어야 한다.

업데이트:

- `bunx github:OWNER/REPO#vX.Y.Z init --version X.Y.Z` 또는 동등 명령이 package reference를 새 tag로 교체한다.
- hand-edit를 기본 경로로 문서화하지 않는다.

### 8.2 Codex

설치:

- `codex-plugin-X.Y.Z.zip`를 unpack하여 local plugin directory에 설치한다.
- plugin 내부 문서는 release tag에 pin된 버전을 따른다.

업데이트:

- 기존 plugin directory를 동일 이름 artifact로 교체한다.
- 수동 병합은 지원 경로가 아니다.

### 8.3 Claude Code

설치:

- `claude-code-support-X.Y.Z.zip`를 unpack하거나 install script를 실행해 `.claude/` support files를 배치한다.

업데이트:

- 기존 generated support files를 artifact 기준으로 재동기화한다.
- 로컬 커스텀 파일은 designated override 위치에서만 유지한다.

## 9. 기능 범위

`0.1.0` 필수 범위:

- `health`
- `list`
- `doctor`
- `editor status`
- `editor open`
- `editor quit`
- `editor restart`
- `editor_control`
- built-in tool discovery
- macOS + Windows x64 native support
- UPM 설치 경로
- Codex/Claude 기본 지원 패키지
- GitHub direct bunx 실행 경로

`0.2.0` 후보:

- SSE events 안정화
- 다중 에디터 인스턴스 정책
- Linux editor 지원
- richer plugin UX
- 프로젝트 bootstrap 고도화
- optional npm mirror for shorter `bunx unictl` UX

## 10. 릴리스 파이프라인

GitHub tag 기준 단일 릴리스 파이프라인을 구성한다.

### 10.1 빌드 단계

1. 버전 동기화
2. CLI 테스트
3. Rust native matrix build
   - macOS
   - Windows x64
4. Unity package assemble
5. Codex plugin assemble
6. Claude Code support pack assemble
7. `release-manifest.json` 및 `SHA256SUMS` 생성
8. root executable shim 검증

### 10.2 검증 단계

1. CLI 단위 테스트
2. transport abstraction 테스트
3. macOS editor smoke
4. Windows editor smoke
5. 버전 일치 검사
6. 샘플 프로젝트 설치 검증
7. tree clean 상태 검사
8. compiled CLI bin 검증
9. fresh Unity project에서 Git URL 설치 검증
10. GitHub direct bunx smoke 검증

### 10.3 공개 단계

1. draft GitHub Release 생성
2. draft release에 최종 asset 업로드
3. release notes 생성
4. promotion gate 통과 후 public release 전환
5. UPM 소비 경로 업데이트
6. Codex/Claude 설치 문서 갱신

### 10.4 릴리스 산출물

GitHub release asset 이름은 아래로 고정한다.

- `release-manifest.json`
- `SHA256SUMS`
- `com.unictl.core-X.Y.Z.tgz`
- `codex-plugin-X.Y.Z.zip`
- `claude-code-support-X.Y.Z.zip`
- `unictl_native-macos-x64-or-universal.tar.gz`
- `unictl_native-windows-x64.zip`

CLI publish 결과:

- GitHub tag-pinned bunx 실행 경로:
  - `bunx github:OWNER/REPO#vX.Y.Z ...`

promotion gate:

- 모든 manifest가 `VERSION`과 일치
- macOS/Windows smoke 통과
- fresh install 검증 통과
- checksum 생성 완료
- tag, release assets, UPM reference version 불일치 없음

## 11. 배포 전 로컬 사전 점검

정식 배포 전에 아래 두 경로를 로컬에서 먼저 검증할 수 있어야 한다.

### 11.1 UPM 로컬 패키지 설치 사전 점검

목적:

- fresh Unity project에서 `com.unictl.core`가 local package reference만으로 resolve되고 compile되는지 확인

검증 방법:

1. scratch Unity project 생성
2. `Packages/manifest.json`에 local package reference 추가
3. Unity batchmode로 프로젝트 open + compile 실행
4. `Packages/packages-lock.json`과 editor log에서 local package registration 확인

manifest 예시:

```json
{
  "dependencies": {
    "com.unictl.core": "file:/ABS/PATH/TO/packages/upm/com.unictl.core"
  }
}
```

성공 기준:

- `com.unictl.core`가 local package로 등록된다
- package dependency가 자동 resolve된다
- compile error 없이 batchmode가 종료된다

주의:

- `UnictlPlayModeTestRunner`와 `EditorControlTool`이 `UnityEditor.TestTools`를 사용하므로, core package가 이 구성을 유지하는 동안 `com.unity.test-framework`를 package dependency로 선언해야 한다
- 현재 Queenzle 내 임베디드 프로토타입에서는 macOS 기본 파일시스템이 case-insensitive라서 문서상 `packages/upm/...` 구조가 실제 파일시스템에서는 `Packages/upm/...`와 충돌할 수 있다
- 이 충돌은 현재 임베디드 검증 환경의 제약이며, 최종 별도 `unictl` 저장소에서는 `packages/upm/...`를 정식 경로로 사용한다

### 11.2 bunx 로컬 실행 사전 점검

목적:

- GitHub tag 배포 전에 local build artifact만으로 `bunx` 실행 경로를 검증

검증 방법:

1. CLI를 self-contained `dist/unictl.js`로 build
2. 루트 executable shim package를 tarball로 pack
3. `bunx --package file:/ABS/PATH/TO/<tarball>.tgz unictl ...`로 실행

명령 예시:

```bash
bun build ./unictl/src/cli.ts --outfile ./dist/unictl.js --target bun
bun pm pack --filename /ABS/PATH/TO/unictl-preflight.tgz
bunx --package file:/ABS/PATH/TO/unictl-preflight.tgz unictl editor status --project /ABS/PATH/TO/PROJECT
```

성공 기준:

- tarball pack이 성공한다
- `bunx --package file:/...tgz unictl ...` 실행이 성공한다
- `editor status`, `health` 같은 read-only smoke command가 정상 응답한다

주의:

- raw local directory를 바로 `bunx . ...`로 실행하는 것은 `0.1.x`의 표준 사전 점검 경로로 채택하지 않는다
- local bunx preflight는 항상 `packed tarball` 기준으로 검증한다

## 12. 구현 단계

### Phase 0: 저장소 재구성 설계 고정

완료 기준:

- 단일 저장소 목표 구조 확정
- 버전 정책 확정
- 배포 단위 경계 확정

### Phase 1: transport abstraction 도입

작업:

- `.unictl/endpoint.json` schema 확정
- CLI transport layer 분리
- macOS Unix socket path 유지
- Windows 확장 지점을 남기되, 이 phase는 macOS 기준 경로를 먼저 안정화

완료 기준:

- CLI가 OS별 endpoint를 추상적으로 읽고 연결한다
- `health`와 `command` protocol shape가 플랫폼 간 동일하다

### Phase 2: UPM 추출

작업:

- 현재 `Assets/Editor/Unictl` 정리
- `com.unictl.core` 패키지 구성
- built-in tools 포함
- macOS native binaries 포함
- package dependencies 선언
- Git URL 설치 검증

완료 기준:

- 샘플 Unity 프로젝트가 UPM 설치만으로 `unictl` core를 로드

### Phase 3: CLI 제품화

작업:

- `bunx github:OWNER/REPO#vX.Y.Z` 기준 UX 정리
- `doctor`, `version`, `init`
- 플랫폼별 editor locator 정리
- `dist/` entrypoint 전환
- root executable shim path 확정

완료 기준:

- 문서에 적힌 CLI 흐름이 macOS 기준으로 재현 가능

### Phase 4: Codex/Claude 지원 패키지

작업:

- generic support assets 작성
- 설치 문서 작성
- 샘플 워크플로우 검증
- 공통 문서 원문을 `docs/standalone/`로 이동
- wrapper/generated file 정책 확정

완료 기준:

- 두 환경 모두에서 `unictl` onboarding이 가능

### Phase 5: 단일 릴리스 자동화

작업:

- GitHub Actions 또는 동등 릴리스 스크립트 구성
- version fan-out 자동화
- release notes 자동화
- release manifest/checksum 생성
- macOS-first draft -> public promotion gate 구성

완료 기준:

- GitHub tag 1회로 CLI, UPM, 지원 패키지 릴리스가 함께 생성

### Phase 6: Windows 최종화

작업:

- Rust crate Windows 빌드
- Windows TCP + token 경로 마감
- `X-Unictl-Token` 검증 추가
- Windows용 plugin import 설정
- Unity Windows editor smoke
- release gate에 Windows 검증 추가

완료 기준:

- Windows x64 Unity Editor에서 `health`와 `list`가 안정적으로 동작하고 최종 release gate가 닫힌다

## 13. 수용 기준

아래가 모두 만족되면 단독배포 1차 완료로 본다.

1. 새 Unity 프로젝트에서 `com.unictl.core` 설치 후 built-in tools가 로드된다.
2. macOS와 Windows x64에서 `bunx github:OWNER/REPO#vX.Y.Z health`가 동작한다.
3. `bunx github:OWNER/REPO#vX.Y.Z editor open/status/quit`이 두 플랫폼에서 동작한다.
4. `doctor`가 CLI/UPM/native 버전 불일치를 감지한다.
5. Codex 플러그인과 Claude Code 지원 패키지가 같은 태그 버전으로 배포된다.
6. GitHub release 하나로 전체 산출물이 추적 가능하다.
7. `release-manifest.json`과 `SHA256SUMS`가 각 릴리스마다 생성된다.
8. Windows endpoint auth가 적용되어 token 없는 요청이 거절된다.
9. Codex/Claude support pack은 thin wrapper 구조를 유지하고 공통 문서 중복을 source of truth로 삼지 않는다.

## 14. 현재 코드 기준 우선 작업 위치

현재 구현에서 바로 이어서 손대야 할 시작점:

- `unictl/src/client.ts`
- `unictl/src/socket.ts`
- `unictl/src/editor.ts`
- `unictl/native/src/lib.rs`
- `Assets/Editor/Unictl/`
- `Assets/Plugins/macOS/unictl_native.bundle`

첫 번째 실제 구현 우선순위:

1. transport abstraction
2. UPM 패키지화
3. `doctor`/`init` 보강
4. Codex/Claude support pack 분리
5. Windows finalization
