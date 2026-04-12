# unictl 실행 백로그

이 문서는 `unictl 0.1.x`를 바로 구현에 착수할 수 있도록 에픽, 작업, 의존성, 완료 기준을 정리한 실행 백로그다.

제품 계약은 [STANDALONE_0_1_SPEC.md](standalone-0.1-spec.md)를 기준으로 한다.

## 1. Critical Path

가장 먼저 고정해야 하는 것은 `standalone repo root + VERSION fan-out + GitHub direct bunx root shim`이다. 그 다음이 `.unictl/endpoint.json` 중심 transport abstraction이고, 이후 `com.unictl.editor` 추출, CLI 제품화, integrations, release automation skeleton을 macOS 기준으로 먼저 안정화한다. Windows x64 지원은 마지막 phase에서 붙여서 최종 release gate를 닫는다.

## 2. Working Assumptions

- canonical release root는 별도 `unictl` 저장소다.
- Queenzle는 consumer repo다.
- `0.1.x` core contract는 `ping`, `editor_control`, `capture_ui`, `ui_toolkit_input`에 한정한다.
- `profiler_frame_dump`, `automation_*`, playmode test orchestration은 core contract 밖에 둔다.
- Windows는 `x64 + localhost TCP + token`만 지원한다.

## 3. Epic A: Repo Foundation

Suggested owner:

- architecture
- release

Dependencies:

- none

Tasks:

- 별도 `unictl` 저장소 루트 구조를 확정한다.
- `/VERSION`, root `/package.json`, `/bunfig.toml`, `/docs/standalone/`를 생성한다.
- root executable shim이 `dist/unictl.js`만 가리키도록 고정한다.
- artifact 이름 규칙과 tag 규칙을 고정한다.
- Queenzle 임베디드 검증 파일을 어떤 순서로 추출할지 목록화한다.

Exit criteria:

- 새 저장소 뼈대가 생기고, `VERSION`과 root shim 계약이 문서와 파일 양쪽에서 일치한다.

## 4. Epic B: Version Fan-out and Release Metadata

Suggested owner:

- release

Dependencies:

- Epic A

Tasks:

- `VERSION`에서 CLI, UPM, native, integrations metadata를 갱신하는 fan-out script를 만든다.
- `release-manifest.json` 생성 스크립트를 만든다.
- `SHA256SUMS` 생성 스크립트를 만든다.
- drift check script를 만든다.
- version mismatch fixture를 만들어 실패 케이스를 검증한다.

Exit criteria:

- `VERSION` 한 번 수정 후 fan-out과 drift check가 자동으로 동작한다.

## 5. Epic C: Transport Abstraction and Endpoint

Suggested owner:

- cli
- platform

Dependencies:

- Epic A

Tasks:

- `.unictl/endpoint.json` schema reader/writer를 구현한다.
- CLI가 소켓 경로 하드코딩 대신 endpoint descriptor를 읽게 바꾼다.
- macOS Unix socket client를 endpoint 기반으로 이관한다.
- Windows용 확장 지점을 고려하되, 이 epic의 구현은 macOS 경로 우선으로 마무리한다.
- stale endpoint recovery 규칙을 `status`, `open`, `restart`에 구현한다.

Exit criteria:

- CLI가 endpoint descriptor를 기준으로 `health`, `list`, `editor status`를 수행한다.

## 6. Epic D: UPM Core Extraction

Suggested owner:

- unity

Dependencies:

- Epic A
- Epic C

Tasks:

- `Assets/Editor/Unictl`에서 core package로 옮길 파일 목록을 확정한다.
- `com.unictl.editor` package layout과 asmdef 경계를 만든다.
- core built-ins 4개만 package-provided stable built-in으로 정리한다.
- `com.unity.test-framework` 의존성이 core package에서 빠지도록 테스트/자동화 경계를 분리한다.
- macOS native plugin을 package 경로에 먼저 배치한다.
- local `file:` 설치와 Git URL `?path=` 설치 smoke를 둘 다 만든다.

Exit criteria:

- fresh Unity project가 `com.unictl.editor` 설치만으로 compile되고 core built-ins를 로드한다.

## 7. Epic E: CLI Productization

Suggested owner:

- cli

Dependencies:

- Epic A
- Epic C

Tasks:

- CLI source를 `packages/cli` 기준으로 정리한다.
- `version`, `doctor`, `init` command를 추가한다.
- `command <tool>` 명령 형태를 명시적으로 정리한다.
- `editor open/status/quit/restart`의 JSON 출력 형식을 고정한다.
- packed tarball preflight script를 만든다.
- GitHub direct `bunx` smoke를 재현 가능한 스크립트로 남긴다.

Exit criteria:

- local tarball preflight와 GitHub direct `bunx` 경로가 같은 root shim 계약 위에서 동작한다.

## 8. Epic F: Integrations

Suggested owner:

- integrations

Dependencies:

- Epic A
- Epic E

Tasks:

- `docs/standalone/`를 source로 삼는 generated artifact policy를 문서화한다.
- Codex plugin skeleton을 만든다.
- Claude Code support pack skeleton을 만든다.
- 설치 확인, `doctor`, `editor` workflow만 포함하는 thin wrapper를 작성한다.
- local override 허용 위치를 정의한다.

Exit criteria:

- Codex와 Claude artifact가 같은 버전 태그를 참조하고 공통 문서를 중복 source로 갖지 않는다.

## 9. Epic G: Release Automation

Suggested owner:

- release

Dependencies:

- Epic B
- Epic D
- Epic E
- Epic F

Tasks:

- GitHub Actions 또는 동등 스크립트로 macOS-first build/release skeleton을 만든다.
- macOS native artifact assemble 단계를 만든다.
- UPM tarball, Codex zip, Claude zip assemble 단계를 만든다.
- release gate에 fresh Unity install, drift check, bunx smoke를 먼저 넣는다.
- Windows gate를 나중에 추가할 수 있도록 workflow 경계를 분리한다.

Exit criteria:

- tag 한 번으로 macOS 기준 artifact가 생성되고 gate 실패 시 public release가 막힌다.

## 10. Epic H: Windows x64 Finalization

Suggested owner:

- platform
- unity

Dependencies:

- Epic C
- Epic D
- Epic E
- Epic G

Tasks:

- Rust native crate의 Windows x64 빌드를 추가한다.
- `unictl_native.dll` export와 Unity import 설정을 맞춘다.
- loopback TCP, token 검증, quit/restart lifecycle을 구현한다.
- Windows sample project smoke script를 만든다.
- release workflow에 Windows artifact와 Windows auth gate를 추가한다.

Exit criteria:

- Windows x64 fresh project에서 `editor open -> health -> list -> quit`가 성공하고, 최종 release gate에 Windows 검증이 포함된다.

## 11. Parallelizable Tracks

- Epic B는 Epic A 직후 병행 가능하다.
- Epic C와 Epic E는 병행 가능하지만 endpoint schema를 먼저 잠가야 한다.
- Epic D와 Epic E는 병행 가능하다.
- Epic F는 Epic E 초안만 나오면 병행 가능하다.
- Epic G는 초반 skeleton 작성이 가능하지만 최종 gate는 Epic D/E/F 결과를 기다린다.
- Epic H는 마지막 phase로 두고, 앞선 epics가 macOS 기준으로 안정화된 뒤 붙인다.

## 12. First 10 Working Days

1. Day 1
- standalone repo 구조 생성
- `VERSION`, root shim, artifact naming 고정

2. Day 2
- version fan-out 초안
- drift check 초안

3. Day 3
- endpoint schema 확정
- CLI endpoint loader 초안

4. Day 4
- macOS client 이관
- stale recovery 초안

5. Day 5
- `com.unictl.editor` package layout 생성
- core built-ins 4개 분리

6. Day 6
- core package에서 test-framework 의존성 제거
- local `file:` install smoke

7. Day 7
- `version`, `doctor`, `init` command 추가
- packed tarball preflight script

8. Day 8
- Git URL install smoke
- Codex/Claude thin wrapper skeleton

9. Day 9
- release workflow skeleton
- macOS-first 통합 smoke 목록 점검

10. Day 10
- Windows finalization backlog 정리
- Windows gate 추가 전 점검 목록 확정

## 13. Immediate Next Tasks

- 별도 `unictl` 저장소를 초기화한다.
- Queenzle에서 추출할 파일 매핑표를 만든다.
- `endpoint.json` 스키마와 `init` 시맨틱을 먼저 코드로 고정한다.
- `com.unity.test-framework`를 core contract 밖으로 밀어내는 구조를 결정한다.
