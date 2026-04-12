# unictl 개발자 세팅 가이드

이 문서는 `unictl` 자체를 개발하는 사람을 위한 환경 세팅, 작업 루프, 로컬 검증 방법을 정리한다.

소비자 입장에서 설치하고 쓰는 방법은 [CONSUMER_GUIDE.md](consumer-guide.md)를 본다.

## 1. 전제

- `0.1.x`의 canonical release root는 별도 `unictl` 저장소다.
- 현재 Queenzle 안의 `unictl/` 관련 구조는 standalone 제품화를 위한 임베디드 prototype이다.
- 이 문서는 별도 `unictl` 저장소를 기준으로 설명하되, 현재 Queenzle에서 검증 가능한 로컬 루프도 함께 적는다.

## 2. 개발 대상 구조

기준 문서:

- 제품 계약: [STANDALONE_0_1_SPEC.md](standalone-0.1-spec.md)
- 실행 백로그: [IMPLEMENTATION_BACKLOG.md](implementation-backlog.md)
- 파일 추출 기준: [EXTRACTION_MAP.md](extraction-map.md)

목표 저장소 구조:

```text
repo/
├── package.json
├── VERSION
├── bunfig.toml
├── dist/
├── docs/standalone/
├── packages/
│   ├── cli/
│   └── upm/com.unictl.core/
├── native/unictl_native/
├── integrations/
│   ├── codex/
│   └── claude-code/
└── scripts/
```

## 3. 필요한 도구

최소 권장 도구:

- Bun
- Rust toolchain with Cargo
- Unity Editor
- Git

현재 dogfooding 기준:

- Queenzle는 Unity `6000.4.0f1`에서 검증 중이다.
- macOS와 Windows x64를 `0.1.x` 지원 범위로 본다.

## 4. 저장소 준비

### 4.1 standalone `unictl` 저장소

권장 흐름:

1. 별도 `unictl` 저장소를 만든다.
2. `VERSION`, root `package.json`, `bunfig.toml`, `docs/standalone/`를 먼저 만든다.
3. `packages/cli`, `packages/upm/com.unictl.core`, `native/unictl_native`, `integrations/*`를 만든다.
4. Queenzle에서 필요한 파일을 [EXTRACTION_MAP.md](extraction-map.md) 기준으로 추출한다.

### 4.2 Queenzle와의 관계

- Queenzle는 standalone `unictl`의 소비자 repo다.
- 초기 dogfooding은 git submodule pinning을 기본안으로 둔다.
- 복사본을 유지한 채 장기 개발하지 않는다.

## 5. 개발 루프

### 5.1 CLI 작업

CLI를 수정할 때는 root executable shim 계약을 깨지 않는 것이 가장 중요하다.

원칙:

- 구현 소스는 `packages/cli/`가 소유한다.
- 실행 표면은 root `package.json`과 `dist/unictl.js`가 소유한다.
- GitHub direct `bunx`는 root shim만 본다.

대표 작업:

- command contract 추가
- endpoint abstraction 이관
- `version`, `doctor`, `init` 구현
- editor locator와 platform handling 정리

### 5.2 Unity package 작업

Unity 쪽은 `com.unictl.core` public contract를 먼저 좁힌다.

`0.1.x` core built-ins:

- `ping`
- `editor_control`
- `capture_ui`
- `ui_toolkit_input`

분리 대상:

- `profiler_frame_dump`
- `automation_*`
- playmode test orchestration
- `com.unity.test-framework`에 묶인 코드

### 5.3 Native 작업

native 쪽 목표:

- macOS bundle 유지
- Windows x64 DLL 추가
- endpoint lifecycle과 transport 계약 일치

중요:

- Windows는 `loopback TCP + X-Unictl-Token`이 `0.1.x` 고정 경로다.
- named pipe와 ARM64는 후속 범위다.

## 6. 로컬 검증 루프

### 6.1 CLI 로컬 preflight

현재 확인된 표준 경로는 packed tarball 기반이다.

```bash
bun build ./packages/cli/src/cli.ts --outfile ./dist/unictl.js --target bun
bun pm pack --filename /ABS/PATH/TO/unictl-preflight.tgz
bunx --package file:/ABS/PATH/TO/unictl-preflight.tgz unictl editor status --project /ABS/PATH/TO/PROJECT
```

원칙:

- raw local directory `bunx . ...`는 표준 경로로 쓰지 않는다.
- 로컬 `bunx` 검증도 운영 경로와 같은 root shim 계약 위에서 본다.

CLI 제품화 메모:

- embedded prototype 단계에서는 `init --repo-url ...` 또는 `init --package-ref ...`를 우선 지원한다.
- 별도 standalone 저장소로 넘어가면 `init`의 기본 git reference는 제품 기본값으로 고정한다.

권장 smoke:

```bash
bun run packages/cli/src/cli.ts version
bun run packages/cli/src/cli.ts doctor --project /ABS/PATH/TO/PROJECT
bun run packages/cli/src/cli.ts init --project /ABS/PATH/TO/PROJECT --package-ref file:/ABS/PATH/TO/packages/upm/com.unictl.core --dry-run
```

Version/release skeleton smoke:

```bash
cd /ABS/PATH/TO/unictl
bun run version:fanout
bun run version:check
bun run release:assemble --output /ABS/PATH/TO/unictl/.tmp/phase-e-release
```

산출물:

- `release-manifest.json`
- `SHA256SUMS`
- `codex-plugin-X.Y.Z.zip`
- `claude-code-support-X.Y.Z.zip`
- `com.unictl.core-X.Y.Z.tgz`

### 6.2 UPM 로컬 설치 preflight

fresh Unity project에 local package reference를 추가해서 compile 성공 여부를 본다.

예시:

```json
{
  "dependencies": {
    "com.unictl.core": "file:/ABS/PATH/TO/packages/upm/com.unictl.core"
  }
}
```

검증 목표:

- package registration 성공
- dependency resolve 성공
- compile error 없이 batchmode 종료

### 6.3 Dogfooding with Queenzle

현재 Queenzle에서 확인할 수 있는 것:

- 기존 Unity project와 editor lifecycle
- UI capture/input loop
- macOS 경로의 기본 transport 동작
- local UPM package install feasibility
- packed tarball `bunx` preflight feasibility

주의:

- 현재 Queenzle 루트의 `Packages/upm/com.unictl.core` 스캐폴딩은 case-insensitive 파일시스템 제약 아래 만든 검증용 구조다.
- 최종 standalone 저장소에서는 문서상 정식 경로인 `packages/upm/com.unictl.core`를 사용한다.

## 7. 권장 작업 순서

1. Repo foundation과 version contract를 먼저 고정한다.
2. `.unictl/endpoint.json` 기반 transport abstraction을 구현한다.
3. `com.unictl.core`를 추출하고 core contract를 정리한다.
4. CLI 제품화와 `doctor`/`init`를 붙인다.
5. integrations와 release automation skeleton을 올린다.
6. Windows x64 native support는 마지막 phase에서 붙인다.

세부 실행 순서는 [IMPLEMENTATION_BACKLOG.md](implementation-backlog.md)를 따른다.

## 8. 페이즈별 커밋 원칙

- 별도 브랜치에서 진행한다.
- 커밋은 phase 또는 epic 경계를 기준으로 자른다.
- 한 커밋에는 한 가지 계약 변화만 담는다.
- 문서, 코드, 검증 스크립트가 같은 phase 경계에 묶이면 함께 커밋한다.

권장 예시:

1. `Phase A: repo foundation and version contract`
2. `Phase B: endpoint abstraction skeleton`
3. `Phase C: core upm extraction`
4. `Phase D: cli productization`
5. `Phase E: integrations and release automation`
6. `Phase F: windows finalization`

## 9. 현재 Queenzle에서 바로 참조할 파일

- CLI source: `packages/cli/src/*`
- native source: `native/unictl_native/src/lib.rs`
- Unity core: `Assets/Editor/Unictl/*`
- 추가 built-ins: `Assets/Editor/ScreenshotBridge.cs`, `Assets/Editor/UiToolkitInputTool.cs`
- macOS plugin artifact: `Assets/Plugins/macOS/unictl_native.bundle`

정확한 이동 목적지는 [EXTRACTION_MAP.md](extraction-map.md)에 정리돼 있다.
