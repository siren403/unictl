# unictl 추출 맵

이 문서는 현재 Queenzle 저장소 안의 `unictl` 관련 파일을 별도 `unictl` 저장소 구조로 옮길 때 사용할 1차 추출 맵이다.

목표 구조와 계약은 [STANDALONE_0_1_SPEC.md](standalone-0.1-spec.md)를 따른다.

## 1. CLI Source

| Current path | Target path | Action | Notes |
| --- | --- | --- | --- |
| `unictl/src/cli.ts` | `packages/cli/src/cli.ts` | move | `version`, `doctor`, `init`, `command <tool>` 추가 예정 |
| `unictl/src/client.ts` | `packages/cli/src/client.ts` | move + refactor | endpoint descriptor 기반 transport abstraction으로 변경 |
| `unictl/src/editor.ts` | `packages/cli/src/editor.ts` | move + refactor | macOS 전용 process 탐지 제거, Windows locator 추가 |
| `unictl/src/socket.ts` | `packages/cli/src/socket.ts` | move + split | endpoint reader와 unix transport helper로 분리 |
| `unictl/package.json` | `packages/cli/package.json` | rewrite | source package metadata만 유지 |
| `unictl/bun.lock` | repo root `bun.lock` | regenerate | standalone repo 기준으로 재생성 |
| `unictl/scripts/build.sh` | `scripts/build/build-cli.sh` | move + rename | root shim build pipeline에 맞게 수정 |

## 2. Native Source

| Current path | Target path | Action | Notes |
| --- | --- | --- | --- |
| `unictl/native/Cargo.toml` | `native/unictl_native/Cargo.toml` | move | package metadata 정리 |
| `unictl/native/Cargo.lock` | `native/unictl_native/Cargo.lock` | move | 필요시 재생성 |
| `unictl/native/src/lib.rs` | `native/unictl_native/src/lib.rs` | move + refactor | Windows TCP/token transport 추가 |

제외:

- `unictl/native/target/`는 추출하지 않는다.

## 3. Unity Core Package

| Current path | Target path | Action | Notes |
| --- | --- | --- | --- |
| `Assets/Editor/Unictl/UnictlToolAttribute.cs` | `packages/upm/com.unictl.core/Editor/Unictl/UnictlToolAttribute.cs` | move | public surface |
| `Assets/Editor/Unictl/ToolRouter.cs` | `packages/upm/com.unictl.core/Editor/Unictl/Internal/ToolRouter.cs` | move | internal surface |
| `Assets/Editor/Unictl/UnictlServer.cs` | `packages/upm/com.unictl.core/Editor/Unictl/Internal/UnictlServer.cs` | move | internal surface |
| `Assets/Editor/Unictl/UnictlNative.cs` | `packages/upm/com.unictl.core/Editor/Unictl/Internal/UnictlNative.cs` | move | internal surface |
| `Assets/Editor/Unictl/PingTool.cs` | `packages/upm/com.unictl.core/Editor/Unictl/Builtins/PingTool.cs` | move | core built-in |
| `Assets/Editor/Unictl/Tools/EditorControlTool.cs` | `packages/upm/com.unictl.core/Editor/Unictl/Builtins/EditorControlTool.cs` | move + narrow | stable action 집합만 core contract |
| `Assets/Editor/ScreenshotBridge.cs` | `packages/upm/com.unictl.core/Editor/Unictl/Builtins/CaptureUiTool.cs` | move + rename | core built-in |
| `Assets/Editor/UiToolkitInputTool.cs` | `packages/upm/com.unictl.core/Editor/Unictl/Builtins/UiToolkitInputTool.cs` | move | core built-in |
| `Assets/Editor/Unictl/Unictl.Editor.asmdef` | `packages/upm/com.unictl.core/Editor/Unictl.Editor.asmdef` | rewrite | package layout에 맞게 reference 정리 |

## 4. Diagnostics or Deferred Surface

| Current path | Target path | Action | Notes |
| --- | --- | --- | --- |
| `Assets/Editor/Unictl/Tools/ProfilerFrameDumpTool.cs` | `packages/upm/com.unictl.diagnostics/Editor/ProfilerFrameDumpTool.cs` or consumer-local | split later | `0.1.x` core contract 밖 |
| `Assets/Editor/Unictl/UnictlPlayModeTestRunner.cs` | deferred | remove from core | `com.unity.test-framework` 의존성 분리 대상 |
| `Assets/Editor/Unictl/UnictlAutomationProfile.cs` | deferred | remove from core | automation 기능은 후속 범위 |

## 5. Native Plugin Artifacts

| Current path | Target path | Action | Notes |
| --- | --- | --- | --- |
| `Assets/Plugins/macOS/unictl_native.bundle` | `packages/upm/com.unictl.core/Plugins/macOS/unictl_native.bundle` | copy from build output | source가 아니라 build artifact |
| Windows build output | `packages/upm/com.unictl.core/Plugins/Windows/x86_64/unictl_native.dll` | add | 새로 생성 필요 |

## 6. Integrations

| Current path | Target path | Action | Notes |
| --- | --- | --- | --- |
| none yet | `integrations/codex/` | create | thin wrapper only |
| none yet | `integrations/claude-code/` | create | thin wrapper only |
| `unictl/STANDALONE_0_1_SPEC.md` | `docs/standalone/standalone-0.1-spec.md` | copy or rename | standalone repo 문서 원문 |
| `unictl/IMPLEMENTATION_BACKLOG.md` | `docs/standalone/implementation-backlog.md` | copy or rename | standalone repo 문서 원문 |
| `unictl/STANDALONE_IMPLEMENTATION_PLAN.md` | `docs/standalone/implementation-plan.md` | copy or rename | 전략 문서 |

## 7. Do Not Extract

- `unictl/.omc/`
- `unictl/node_modules/`
- `unictl/native/target/`
- Queenzle 전용 `Assets/Editor/Queenzle.Editor.asmdef`
- 로컬 preflight 전용 `Packages/upm/com.unictl.core/` 스캐폴딩
- 루트 `package.json`, `bunfig.toml`, `VERSION`, `dist/`는 standalone repo에서 새로 생성하거나 이관 기준에 맞게 재작성한다

## 8. Extraction Order

1. CLI source와 native source를 standalone repo로 먼저 옮긴다.
2. Unity core package를 `com.unictl.core` 구조로 재배치한다.
3. core contract 밖 파일을 diagnostics 또는 deferred bucket으로 분리한다.
4. native build output을 package plugin 경로로 복사하는 build script를 만든다.
5. root shim과 release scripts를 맞춘다.
6. Queenzle를 standalone repo 소비자로 전환한다.
