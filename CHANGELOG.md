# Changelog

All notable changes to unictl are documented in this file.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/).

Breaking changes in a release require a corresponding entry in [MIGRATION.md](MIGRATION.md).

---

## [Unreleased]

### Added
- Repo-local `AGENTS.md` and mise-based project runtime/task harness for agent sessions.
- Unity `.meta` GUID validation for the bundled UPM editor package to catch duplicate, placeholder, and low-entropy GUIDs before release.

### Changed
- Release validation now runs the error registry drift check and Unity `.meta` GUID check before packaging.

---

## [0.6.3] - 2026-04-30

### Fixed
- Replaced placeholder Unity `.meta` GUIDs for `BuildEntry.cs` and `BuildRunner.cs` to avoid package import conflicts in consumer projects.

---

## [0.6.2] - 2026-04-30

### Added
- Unity consumer smoke-test sandbox under `sandbox/UnictlSmokeProject` for validating Git UPM install, package resolve, and compile flows against a real Unity project.

### Changed
- `unictl init` help, JSON output, capabilities metadata, and standalone docs now clarify that `init` only edits `Packages/manifest.json`; Unity resolves/imports the package on Package Manager refresh, editor restart, or batch compile.

---

## [0.6.1] - 2026-04-28

---

## [0.6.0] - 2026-04-28

### Added
- `unictl test` editor lane: 에디터 실행 중 시 IPC를 통해 `TestRunnerApi.Execute`로 테스트 실행 (`--batch` 없이 호출). batchmode 대비 새 Unity 프로세스 띄우는 비용 없음.
- `test_run` UnictlTool: editor lane IPC 핸들러. 즉시 `queued` 응답 후 비동기 실행, progress file로 결과 전달.
- `--allow-unsaved-scenes` 플래그: PlayMode dirty scene 우회.
- `--allow-reload-active` 플래그: PlayMode + Full Reload 강제 시도 (위험).
- 11종 에러 kind: `editor_busy_playing`, `editor_busy_compiling`, `editor_busy_updating`, `editor_dirty_scene`, `editor_dirty_prefab_stage`, `editor_reload_active`, `results_path_unwritable`, `test_already_running`, `editor_died`, `editor_session_changed`, `test_heartbeat_stale`.
- `UnictlServer.SessionId`: editor 세션 식별 (UUID v4).

### Changed
- `unictl test`: 기본 동작 변경. 이전에는 `--batch`가 필수였으나, 이제 에디터 실행 감지 시 자동으로 editor lane 사용. 에디터 미실행 시 `editor_not_running` 에러로 batchmode 안내.
- `editor.ts`: 누락된 `readFileSync` import 추가 (failure path에서 발생하는 `ReferenceError` 수정).

### Fixed
- (해당 없음, 신규 기능 위주)

---

## [0.5.0] - 2026-04-27

### Added
- `--json` flag on `unictl --help` and every subcommand `--help` emits machine-readable JSON instead of human-formatted text. Cold-start agents can introspect subcommand list, flags, and exit codes without parsing terminal output.
- `hint_command` field in error responses: every `errorExit(...)` now appends the registered `hint_command` template from `error-registry.json` (e.g., `"unictl command build_status -p job_id=<YOUR_JOB_ID>"`). Agents can convert error → next-action programmatically.
- `packages/cli/src/error.ts` (new): centralized error helper that looks up `hint_command` from the registry and emits the unified error JSON shape.
- `packages/cli/src/help-json.ts` (new): structured help formatter sourced from `capabilities.json`.

### Changed
- `BuildProfileAdapter.IsValidProfileAsset` no longer guards with `File.Exists` (was fragile in batchmode where cwd may differ from project root). Relies entirely on `AssetDatabase.LoadAssetAtPath<BuildProfile>` which is project-root-relative by definition.
- CI smoke workflow runs `check:error-registry` on all 3 OS (was Linux-only) — catches CRLF / encoding / path drift on Windows and macOS.
- Release rehearsal workflow hardened:
  - Content-level assertion on `.tmp/phase-e-release/` (artifacts present, not just directory exists).
  - File-count assertion data-driven from `release.ts` `VERSIONED_*` arrays (was hardcoded `-ne 6`).
  - Cleanup step removes silent `|| true`; asserts clean tree post-cleanup or fails the job.

### Fixed
- CI smoke workflow: `bun run unictl -- --help` failed on all 3 OS runners with "Script not found". Added `unictl` script to root `package.json` so the ergonomic pattern works in the standalone repo checkout context (previously only worked inside PickUpCat consumer-monorepo).
- Windows process discovery on modern runners (Windows Server 2022, Windows 11 recent): `listUnityProcessesWindows` propagated a `wmic` ENOENT exception when `Get-CimInstance` returned empty stdout (zero Unity processes). Two fixes: (1) CIM empty-stdout is now treated as "zero processes" instead of "CIM failed + fallthrough to wmic", (2) wmic fallback itself is wrapped in try/catch returning `[]` on ENOENT. `doctor`/`editor status`/`health` no longer crash on Unity-absent Windows runners.
- `--build-profile` UNC path explicit rejection: `\\server\share\Foo.asset` now returns `profile_invalid_path` (exit 2) instead of being silently normalized to forward slashes and passed to Unity batchmode (where behavior was undefined).
- `getUnityPid` case-insensitive `-projectpath` matching: Unity Hub launches with lowercase `-projectpath`, our matcher used camelCase `-projectPath`. `editor status` / preflight checks falsely returned "not running" when Unity was actually open. Now matches both case variants and case-insensitively for the path argument too (Windows is case-insensitive for filesystem paths).
- `compile` output no longer self-contradicts when Unity exits non-zero with empty errors: object-spread ordering bug caused `result.ok=true` (set when exitCode != -1) to override the explicit `ok: false` we tried to set. Fixed by spreading first then overriding. Message also clarified: empty-errors case now reads `"Unity batchmode exited with code N (no compile errors detected; check log_file for cause)"` instead of misleading `"Compile failed: 0 error(s)"`.
- `compile` and `editor` (status/quit/open/restart) error responses now include the `hint_command` field (Codex review response). Previously these emitted `output({ ok: false, error: { kind, message } })` directly, bypassing `errorExit()` and dropping the field. The CHANGELOG claim "every error response carries hint_command" is now accurate.
- `release-rehearsal.yml` artifact threshold tightened from `>= 2` to `>= 5` to match comment intent (upm.tgz + 2 zips + manifest + SHA256SUMS = 5 minimum).

---

## [0.4.0] - 2026-04-24

### Added
- `unictl capabilities` subcommand: prints offline capabilities JSON for cold-start agent discovery.
- `packages/cli/src/capabilities.json`: hand-maintained schema (subcommands, builtins, params, exit codes, transports, known limitations).
- CI drift check extended to verify capabilities.json ↔ error-registry.json consistency and version sync with package.json.
- Unified release driver: `scripts/release.ts` now invokes `scripts/release/assemble.ts` as a post-version-sync step, building Codex/Claude integration artifacts and checksums.
- `--dry-run` flag for `bun run release`: runs version sync + assemble + validation without pushing, tagging, or publishing.
- Idempotency guard in release script: exits early if `package.json` is already at the target version and a release commit for it already exists.
- CHANGELOG.md validation in release script: aborts if `[Unreleased]` section is missing or has no entries.
- `integrations/_template/` directory with explicit `{{OWNER}}`, `{{REPO}}`, `{{VERSION}}` placeholder tokens for downstream scaffolders.
- `DEPRECATION.md` documenting the switch from placeholder-based to version-matched integration metadata.
- `MIGRATION.md` documenting the 0.3.0 → 0.4.0 migration path.
- `docs/standalone/release-process.md` documenting the 5-step release order and partial-release recovery table.

### Changed
- Release step order rewritten to eliminate orphan-tag risk: commit (local) → npm publish → git push main → git tag → git push tag.
- Integration metadata (`integrations/codex/plugin.config.json`, `integrations/claude-code/support-pack.json`) now ships version-matched to the unictl release. `OWNER/REPO` placeholders replaced with `siren403/unictl`.
- Integration metadata files added to the version-sync list in `release.ts` so they are bumped on every release.

### Removed
- `lock_held` error kind (zombie entry) removed from `error-registry.json` and `HintTable.cs`. It was never reachable after the WebForge simplification in v0.3.0.

---

## [0.3.0] - 2025-04-24

See also: release notes draft at `.omc/plans/unictl-v0.3.0-release-notes.md`.

### Added
- `build_project` builtin: dual-lane auto-routing (IPC when editor is running, batchmode when closed). Overrides: `--force-ipc`, `--batch`.
- `build_project` progress file: `Library/unictl-builds/<job_id>.json`, atomic via `File.Replace`, BOM-safe reader.
- `build_project` terminal states: `done | failed | aborted`. Output metadata: `output_kind`, `size_bytes`, `artifact_sha256`, `directory_manifest_sha256`.
- Unity 6+ BuildProfile support via `-activeBuildProfile` CLI flag (batchmode only; IPC rejects with `profile_switch_requires_batch`).
- `build_status` builtin: reads `<job_id>.json` with BOM strip and reader retry for Windows AV/Dropbox handle races.
- `build_cancel` builtin: queue-stage cooperative cancel. Returns `not_cancellable` once running. Idempotent on terminal states; marks orphan non-active jobs as aborted.
- `unictl compile` subcommand: headless batchmode compile + `.meta` generation. Exit codes: 0 (success), 1 (compile errors), 3 (project locked), 124 (timeout).
- Capability discovery: `unictl build --help`, `unictl command list`, `unictl command <tool>` all document parameters, defaults, examples, and companion tools.
- Every error response carries a `hint` field pointing to the correct discovery command.

### Fixed
- P5 hardening (Codex review): batchmode preflight exit mapping, realpath canonicalization, post-spawn profile verification, CLI version gate, help text correction, build_status error taxonomy split.
- P5 code-review: path traversal rejection, unsupported-unity emit, exit-code polish.

---

## [0.1.9] - 2025-01-01

### Fixed
- `execute_menu` changed to fire-and-forget to prevent pipe timeout on long-running builds.

---

## [0.1.8] - 2024-12-20

### Added
- `editor_log` builtin tool with agent-friendly UX redesign for discoverability.

---

## [0.1.7] - 2024-12-15

### Fixed
- Use full `FindObjectsByType` overload for Unity 6 compatibility.

---

## [0.1.6] - 2024-12-10

### Added
- `ugui_input` builtin tool for UGUI E2E testing.
- `editor_log` builtin tool.
- `TestSceneBuilder` for UGUI E2E test scenes.
- Tool extensibility hints to command help and list output.
- Agent-friendly UX improvements in CLI and list output.

### Fixed
- `editor_log` sharing violation + editor open reliability.
- Unity 6000.0 compat: remove deprecated `FindObjectsSortMode`, fix `ScrollRect` not being `Selectable`.
- Remove fallback that matched unrelated Unity processes.
- `ToolParams` `GetInt`/`GetFloat` parse string values from `-p` flags.

---

## [0.1.5] - 2024-11-20

### Fixed
- Show parameter passing methods in `command --help`.

---

## [0.1.4] - 2024-11-15

### Added
- `execute_menu` builtin tool.

### Fixed
- Unity 6000.0 `FindObjectsByType` compat + CLI help subcommands.

---

## [0.1.3] - 2024-11-10

### Changed
- Restructured project for npm publish as `unictl`.

---

## [0.1.2] - 2024-11-05

### Changed
- Replaced build pipeline with single release script.
- Removed `dist/`, run CLI directly from TypeScript source.
- Removed `VERSION` file; use `package.json` as repo root marker.

---

## [0.1.1] - 2024-10-30

### Added
- Windows Named Pipe transport for native plugin.
- Windows compatibility for editor process detection and control.
- `init` command: zero-arg with auto repo URL and `--head` flag.

### Fixed
- Derive CLI help version from `package.json` instead of hardcoding.

---

## [0.1.0] - 2024-10-20

### Added
- Initial release. CLI ↔ named-pipe IPC ↔ UPM architecture.
- macOS Unix Socket + HTTP transport (tiny_http).
- Windows Named Pipe transport.
- `editor` subcommand for editor lifecycle control.
- `command` subcommand for builtin tool dispatch.
- `doctor` subcommand for project/environment health checks.
- `health` subcommand.
- `init` subcommand for UPM dependency scaffolding.
- UPM package `com.unictl.editor` for Unity integration.
- Rust native bridge (`unictl_native`) via FFI.

[Unreleased]: https://github.com/siren403/unictl/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/siren403/unictl/compare/v0.1.9...v0.3.0
[0.1.9]: https://github.com/siren403/unictl/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/siren403/unictl/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/siren403/unictl/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/siren403/unictl/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/siren403/unictl/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/siren403/unictl/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/siren403/unictl/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/siren403/unictl/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/siren403/unictl/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/siren403/unictl/releases/tag/v0.1.0
