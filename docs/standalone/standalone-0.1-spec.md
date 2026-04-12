# unictl 0.1.x 고정 스펙

이 문서는 `unictl` 단독배포 `0.1.x`에서 구현자가 더 이상 추측하지 않도록 고정한 실행 계약이다.

전략 배경과 넓은 제품 계획은 [STANDALONE_IMPLEMENTATION_PLAN.md](implementation-plan.md)에 남기고, 이 문서는 `0.1.x`에서 실제로 만들 것만 못 박는다.

## 1. Canonical Repo

- `0.1.x`의 canonical release root는 별도 `unictl` 저장소다.
- Queenzle 저장소는 `unictl`의 소비자이자 dogfooding 환경이다.
- Queenzle 내부 `unictl/`, `Packages/upm/com.unictl.core`, `dist/`, 루트 `package.json`은 feasibility 검증 흔적일 뿐, 최종 릴리스 루트가 아니다.
- 새 저장소 이름 기본값은 `unictl`로 고정한다.

## 2. Repo Ownership Matrix

| Path | Role | Type | Public contract | Notes |
| --- | --- | --- | --- | --- |
| `/package.json` | GitHub direct `bunx` root executable shim | source | yes | root `bin.unictl` only |
| `/VERSION` | single version source of truth | source | yes | 사람이 릴리스 시점에 수정 |
| `/dist/` | built CLI artifact | generated | yes | root shim이 참조 |
| `/docs/standalone/` | shared product docs | source | yes | integrations가 여기서 파생 |
| `/packages/cli/` | CLI source | source | no | 배포 표면이 아니라 구현 소스 |
| `/packages/upm/com.unictl.core/` | core UPM package | source | yes | 유일한 public core UPM package |
| `/native/unictl_native/` | Rust native crate | source | no | platform artifact source |
| `/integrations/codex/` | Codex thin wrapper pack | source + generated | yes | 공통 문서 재포장만 담당 |
| `/integrations/claude-code/` | Claude Code thin wrapper pack | source + generated | yes | 공통 문서 재포장만 담당 |
| `/scripts/` | build/release/version fan-out | source | no | 릴리스 자동화 전용 |

## 3. Fixed 0.1 Decisions

### 3.1 Delivery

- 운영 CLI 진입점은 항상 `bunx github:OWNER/REPO#vX.Y.Z ...`다.
- 로컬 사전 점검은 항상 `bunx --package file:/ABS/PATH/TO/<tarball>.tgz unictl ...`다.
- raw local directory `bunx . ...`는 `0.1.x` 표준 경로가 아니다.
- `bunx`는 root executable shim만 실행 대상으로 삼고, workspace 해석에 의존하지 않는다.

### 3.2 Versioning

- `VERSION`만 사람이 수정한다.
- package manifest, release metadata, integration metadata는 fan-out script가 생성 또는 동기화한다.
- tag는 항상 `vX.Y.Z`다.
- release 전에 version drift 검사를 통과하지 못하면 실패한다.

Version write order:

1. 사람이 `/VERSION` 수정
2. `scripts/version/fanout`이 package metadata 동기화
3. 검증 단계에서 drift 검사
4. tag `vX.Y.Z` 생성
5. release artifact assemble

### 3.3 Runtime Model

- 프로젝트당 활성 editor session은 하나만 지원한다.
- `.unictl/endpoint.json`은 CLI가 읽는 유일한 discovery artifact다.
- `pid`는 liveness hint일 뿐 단독 source of truth가 아니다.
- stale endpoint는 probe failure + pid mismatch 또는 missing process로 판정한다.
- `editor open`과 `editor restart`는 항상 새 session token을 발급한다.

### 3.4 Integrations

- Codex와 Claude Code 지원 패키지는 thin wrapper만 제공한다.
- 공통 문서 원문은 `docs/standalone/`에만 둔다.
- integration artifact 안의 문서는 generated copy로 취급한다.
- 사용자의 로컬 override는 designated override path에서만 유지한다.

## 4. CLI Contract

### 4.1 Output policy

- 성공 응답은 stdout JSON 한 덩어리로 출력한다.
- 실패 응답도 stdout JSON으로 출력하되 process exit code는 non-zero다.
- 사람 친화적인 추가 설명은 stderr에만 쓸 수 있다.
- `0.1.x`에서는 command별 응답 schema를 문서화하지만, transport별 포맷 차이는 허용하지 않는다.

### 4.2 Required commands

| Command | 0.1 status | Minimum behavior | Failure behavior |
| --- | --- | --- | --- |
| `health` | required | endpoint probe와 서버 상태 반환 | unreachable면 non-zero |
| `list` | required | built-in + project-local tool schema 반환 | unknown/transport error면 non-zero |
| `version` | required | CLI version과 source metadata 반환 | version metadata missing이면 non-zero |
| `doctor` | required | install, endpoint, version drift, transport 상태 진단 | any failed check면 non-zero |
| `init` | required | `manifest.json`에 `com.unictl.core` 항목 추가 또는 갱신 | destructive change 필요시 non-zero |
| `editor status` | required | running, pid, endpoint, health 요약 반환 | transport read 실패면 non-zero |
| `editor open` | required | editor launch 후 ready endpoint 확인 | live session 존재 시 non-zero |
| `editor quit` | required | graceful quit 후 endpoint 제거 확인 | timeout or failure면 non-zero |
| `editor restart` | required | quit 후 새 token/session 발급 확인 | restart incomplete면 non-zero |
| `command <tool>` | required | arbitrary `UnictlTool` invocation passthrough | tool error면 non-zero |

### 4.3 `init` semantics

- `init`은 `com.unictl.core` 한 항목만 관리한다.
- `init`은 idempotent해야 한다.
- unrelated dependency와 registry 설정은 보존해야 한다.
- `init --dry-run`과 `init --force`를 제공한다.
- 수동 수정한 custom ref를 덮어써야 할 때는 `--force` 없이는 실패한다.

## 5. UPM Core Contract

### 5.1 Public package

- public package는 `com.unictl.core` 하나만 둔다.
- fresh Unity project에 설치 가능해야 한다.
- `0.1.x` core package는 `com.unity.test-framework`에 의존하지 않는다.
- 플랫폼별 native plugin은 core package 내부에 동봉한다.

### 5.2 Public surface vs internal surface

| Surface | Status | Rule |
| --- | --- | --- |
| `UnictlToolAttribute` | public | 소비자 프로젝트가 확장 명령을 선언할 때 사용 |
| `ToolRouter` | internal | package 내부 구현으로 취급 |
| `UnictlServer` | internal | package 내부 구현으로 취급 |
| `UnictlNative` | internal | package 내부 구현으로 취급 |
| Built-in tools | mixed | 아래 core built-ins만 0.1 public contract |

### 5.3 Core built-ins

| Tool | 0.1 status | Stable contract |
| --- | --- | --- |
| `ping` | required | 연결 sanity check |
| `editor_control` | required | `play`, `stop`, `refresh`, `compile`, `restart`, `status`, `quit`, `load_scene` |
| `capture_ui` | required | screenshot capture |
| `ui_toolkit_input` | required | inspect, click, set_value, scroll |
| `profiler_frame_dump` | optional | diagnostics add-on 또는 consumer-local tool |

- `automation_*`와 playmode test orchestration action은 `0.1.x` core contract에 포함하지 않는다.
- 소비자 프로젝트 확장 명령은 프로젝트 로컬 `[UnictlTool]`로 추가한다.

### 5.4 Package layout default

| Path | Rule |
| --- | --- |
| `Editor/Unictl/` | core server, attributes, router, built-ins |
| `Editor/Unictl/Builtins/` | package-provided stable built-ins |
| `Editor/Unictl/Internal/` | internal helpers only |
| `Plugins/macOS/` | `unictl_native.bundle` |
| `Plugins/Windows/x86_64/` | `unictl_native.dll` |

## 6. Endpoint Contract

### 6.1 Discovery file

Path:

- `<projectRoot>/.unictl/endpoint.json`

Required fields:

| Field | macOS | Windows | Notes |
| --- | --- | --- | --- |
| `schema` | `1` | `1` | schema version |
| `transport` | `unix` | `tcp` | fixed for `0.1.x` |
| `path` | required | n/a | unix socket path |
| `host` | n/a | `127.0.0.1` | fixed loopback |
| `port` | n/a | required | ephemeral allowed |
| `token` | n/a | required | rotate every open/restart |
| `pid` | required | required | liveness hint |
| `projectRoot` | required | required | canonical absolute path |

### 6.2 Lifecycle

- editor startup는 endpoint file을 atomic write한다.
- domain reload는 같은 session이면 endpoint를 유지한다.
- graceful quit는 endpoint file을 삭제한다.
- startup 중 crash나 force quit로 file이 남으면 stale recovery 대상이다.
- stale recovery는 `status`, `open`, `restart`에서 수행한다.

### 6.3 Auth and staleness

- Windows는 모든 request에 `X-Unictl-Token`을 요구한다.
- token 없는 요청은 `401` 또는 `403`으로 거절한다.
- token은 `editor open`과 `editor restart`마다 새로 발급한다.
- stale 판정은 아래 조건 중 하나면 충분하다.
- endpoint probe timeout
- `pid` 없음
- `pid`가 죽어 있음
- `projectRoot` mismatch

## 7. Queenzle Migration Path

1. standalone `unictl` 저장소를 먼저 만든다.
2. 현재 Queenzle 구현에서 CLI, native, Unity core를 새 저장소 구조로 추출한다.
3. Queenzle는 새 저장소를 git submodule로 pin해서 소비한다.
4. dogfooding이 안정되면 Queenzle의 직접 복사본을 제거한다.
5. 첫 안정 릴리스 후에는 submodule 유지 또는 version-pinned dependency 전환 중 하나를 선택한다.

## 8. Definition of Done for 0.1.0

- fresh Unity project가 `com.unictl.core` 설치만으로 compile된다.
- macOS와 Windows x64에서 `bunx github:OWNER/REPO#v0.1.0 health`가 동작한다.
- `editor open`, `editor status`, `editor quit`, `editor restart`가 두 플랫폼에서 동작한다.
- `doctor`가 CLI, UPM, native version drift를 실패로 보고한다.
- `init`을 두 번 실행해도 unrelated dependency가 보존된다.
- Windows token 없는 직접 요청이 거절된다.
- Queenzle가 standalone `unictl` 소비자 프로젝트로 동작한다.
