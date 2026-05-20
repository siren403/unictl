# Changelog

All notable changes to unictl are documented in this file.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/).

Breaking changes in a release require a corresponding entry in [MIGRATION.md](MIGRATION.md).

---

## [Unreleased]

### Fixed

- `unictl editor compile --wait idle` now reports compile lifecycle proof from
  Unity `CompilationPipeline` events, including observed start/finish sequence
  and confidence, so agents no longer have to infer compile completion from
  idle state or editor logs alone.

---

## [0.7.12] - 2026-05-20

---

## [0.7.12] - 2026-05-20

### Fixed

- Clarified `unictl build --method` custom build reporting guidance across
  help, schema, capabilities, and workflows so project wrappers map
  `BuildReport` success/failure to `UnictlBuildContext` terminal reports.
- Fixed build lifecycle progress writes so terminal custom-method reports
  preserve the original `started_at`, emit ISO `finished_at`, and avoid
  Windows read/write races that could leave `unictl build --wait` stuck in
  `running`.
- Added a CLI file fallback for `editor_log` so transient IPC failures can still
  return `Library/unictl-state/editor-current.log` data with
  `fallback_kind=cli_project_log_file` instead of only surfacing a generic pipe
  reachability error.

---

## [0.7.11] - 2026-05-20

---

## [0.7.11] - 2026-05-20

### Added

- Added the live-editor `hierarchy_tree` builtin tool for agent path discovery.
  It lists loaded scene roots and Play Mode `DontDestroyOnLoad` roots, with
  depth, component, name, and payload-limit filters.
- Added `unictl schema build` and build lifecycle metadata for agent
  discovery.
- Added first-class `unictl build status --job-id <id>` and
  `unictl build cancel --job-id <id>` commands.
- Added custom build method support via `unictl build --method
  Namespace.Type.Method`, plus public `UnictlBuildContext` /
  `UnictlBuildScope` APIs for scope-based lifecycle reporting.
- Added static scene and prefab asset hierarchy inspection to
  `hierarchy_tree` via `target=scene_asset` and `target=prefab_asset`.

### Fixed

- `editor_log` now reports unknown parameters, valid parameter names, and valid
  actions when callers omit or misspell the required `action` parameter.
- `unictl editor <unknown>` now returns close subcommand suggestions and
  machine-readable remediation instead of only citty's generic unknown command
  output.
- `unictl command attach_property` invalid `value` responses now include valid
  wrapper keys and examples such as `{"string":"foo"}` and `{"int":42}`.
- `unictl build --wait` and `build_status` now expose normalized lifecycle
  fields (`queued`, `running`, `succeeded`, `failed`, `cancelled`) instead of
  requiring agents to interpret raw progress-file states.

---

## [0.7.10] - 2026-05-19

---

## [0.7.10] - 2026-05-19

---

## [0.7.10] - 2026-05-19

### Added

- Added CLI/UPM version compatibility diagnostics and workflow guards. Unsafe
  editor-side workflows now fail with machine-readable remediation when the CLI
  is older than the Unity package, the Unity package is older than the CLI, or
  version metadata is missing.

### Fixed

- Editor-side `compile`, `refresh`, `wait`, and editor-lane `test` failures now
  check live `editor_log` compile errors and return
  `editor_compile_error_state` with `compile_errors` context, preventing agents
  from misattributing Unity C# compile-error states to DLL, UPM, or IPC causes.

---

## [0.7.9] - 2026-05-19

---

## [0.7.9] - 2026-05-19

---

## [0.7.9] - 2026-05-19

### Fixed

- `editor_log` now fails closed with structured remediation details when the
  project-scoped editor log is missing or predates the current Unity process,
  allowing callers to detect `requires_editor_restart=true` instead of acting
  on stale log data.

---

## [0.7.8] - 2026-05-15

### Fixed

- `editor open` now starts Unity with project-scoped editor and UPM logs under
  `Library/unictl-state/`, `editor_log` reads the project log by default, and
  editor-lane `unictl test` results now include the current editor session
  `log_file`. Deprecated `game_logs` now fails with a replacement hint instead
  of exposing an unreliable in-memory buffer.
- Added `unictl command editor_log --format text` for shell pipelines. Text
  mode prints raw tail lines, search match text, or grouped error text while
  keeping JSON as the default command output.
- Promoted `editor status` to a rich ready-state snapshot, taught `wait` and
  `editor compile --wait` to share that readiness signal, and allowed
  `editor compile --wait` to join in-flight compile/import/reload windows
  instead of failing on transient stale heartbeat or IPC unavailability.
- Added `unictl test wait <job-id>` as the first-class completion detector for
  raw editor-lane `test_run` jobs, reusing the same BOM-safe progress JSON,
  editor PID/session, stale heartbeat, timeout, and terminal-state checks as
  `unictl test`.
- Documented the stable `unictl test` control contract: batch EditMode uses the
  bundled `-executeMethod`/`TestRunnerApi` runner, editor lane uses the
  progress-file job contract, and lane auto-routing is explicit.
- Aligned `unictl test --timeout` with `unictl wait` duration parsing and made
  successful test output include the selected lane. Editor-lane heartbeat stale
  detection now uses a 30s ceiling with structured context instead of a 5s
  hard-coded cutoff.
- `unictl test` now rejects `--results` paths under the Unity project `Temp/`
  directory before launch because Unity may delete that directory during batch
  lifecycle cleanup after XML is saved.
- Added a sandbox EditMode NUnit fixture used to verify both batch
  `-executeMethod` and editor-lane test completion detection.
- Added regression coverage for the Unity `.meta` GUID release guard, including
  duplicate GUIDs, known placeholder GUIDs, and sequential-looking sample GUIDs.
- Added `execute_menu` menu discovery diagnostics: `action=search` and
  `action=list` can inspect Unity-version-specific menu paths, and failed
  synchronous execution now returns candidate suggestions. `unictl command`
  now exits non-zero when a builtin returns `success:false` / `ok:false`.
- Added live Domain Reload diagnostics to `editor_control action=status` and
  `test_run` preflight errors, so `editor_reload_active` false positives can be
  inspected from IPC instead of guessing from Unity UI state.
- Fixed `input set --restart` so it uses the real `editor quit` lifecycle
  before editing `ProjectSettings.asset`. The previous path called a
  non-existent `editor_quit` IPC command and always fell back to
  `editor_running`.
- Added `unictl schema` as the canonical machine-readable command contract
  surface for agents, routed root `--help` to it, and deprecated
  `--describe` / `describe-all` as compatibility aliases.
- Fixed `editor open --wait` and `wait reachable` so `reachable` resolves as
  soon as the IPC handler is registered. The previous predicate also required
  heartbeat state, which could hang even while `/health` and other IPC commands
  were already usable.
- Added an audit trail for `editor_control` `quit` and `restart` requests.
  The editor now writes a structured `Debug.Log` line and a rolling
  `Library/unictl-state/editor-control.log` JSONL file with caller metadata
  such as client PID, CLI args, transport, request id, project root, and editor
  session id.
- Added `flush_assets` to the `execute_menu` builtin. When enabled, the menu
  item runs synchronously and calls `AssetDatabase.SaveAssets()` before
  returning, so PlayerSettings/ProjectSettings mutations can be observed by
  external tools immediately.

---

## [0.7.7] - 2026-05-14

### Fixed

- Made the release process stage the full repository with `git add -A` and
  assert a clean tree after the release commit, so npm publish and git tags
  cannot silently omit source, validation, or documentation changes.

---

## [0.7.6] - 2026-05-14

### Fixed

- Fixed the release script staging list to include `scripts/release.ts` itself,
  preventing release-process fixes from being left only in the local worktree.

---

## [0.7.5] - 2026-05-14

### Fixed

- Fixed the release script staging list so source, validation, and agent
  documentation changes are committed into the release tag instead of only
  being present in the npm publish working tree.

---

## [0.7.4] - 2026-05-14

> Note: `unictl@0.7.4` was published to npm, but the git tag did not include
> all source/documentation changes from the working tree. Use `v0.7.5` or newer
> as the canonical release for this fix.

### Fixed

- Fixed agent-facing command discovery drift for nested v0.7 commands. Structured
  `--help --json`, `describe-all`, and `capabilities` now expose
  `editor compile --wait`, `editor refresh --wait`, and other nested commands
  consistently.

### Documentation

- Added `docs/standalone/agent-discovery.md` and linked it from `AGENTS.md` so
  future command/flag changes update `describe`, `capabilities`, and JSON help
  surfaces together.

---

## [0.7.3] - 2026-05-07

---

## [0.7.3] - 2026-05-07

---

## [0.7.3] - 2026-05-07

### Added

- `unictl editor open --wait <state>` and `--timeout <duration>` flags. The
  bare `--wait` form defaults to `reachable` (the v0.7 ready-sync state).
  citty consumes `--timeout` as the wait value when both appear in
  `--wait --timeout 30s` form, so a `rawArgs` probe recovers it. Default
  ceiling falls through to `(any).reachable=120s`; `--timeout 5m` (or `0`
  unbounded) is recommended for cold-start projects.
- `unictl editor quit --timeout <duration>` flag. Caps the graceful quit
  ceiling before SIGTERM fallback (default 15s). Useful when callers know
  the editor is responsive and want a tighter ceiling.

### Changed

- `editor open --wait reachable` now short-circuits the wait engine when the
  editor is already running. A single `/health` probe confirms the IPC
  handler is registered and returns immediately. The wait engine's
  `reachable` predicate also checks `phase_override`, which flips to
  `unresponsive` whenever the editor is unfocused (Unity throttles
  `EditorApplication.update` so heartbeat stalls). Treating that as
  not-ready was a false negative for ready-sync — the IPC channel is fully
  functional. Cold-starts and non-`reachable` wait targets still use the
  full engine.
- `editor.ts` `editorOpen()` "already running" throw now attaches
  `kind = "editor_running"` and `pid`. Without the kind tag, `cli.ts` was
  catching it as `ipc_error` and the idempotent-ready branch couldn't
  fire.
- `editor.ts` `editorQuit()` polling uses PID-disappearance as the single
  source of truth. The previous endpoint-OR-pid form was a false-positive
  hazard: the named-pipe descriptor file can disappear during Unity's
  graceful shutdown sequence while the process is still alive (saving
  caches, finishing asset import). PID-gone is the only signal that
  proves termination.

### QA infrastructure (mise + bun)

- New mise task tree under `.mise/tasks/qa/` exercises the v0.7 runtime
  contract end-to-end. Tasks share `.mise/qa-lib.ts` (`TaskRunner`,
  `runUnictl`, `parseJsonLine`, `isEditorReachable`, `PROJECT_ROOT`) and
  emit JSON on stdout / banner on stderr. Step results report PASS / FAIL
  / SKIP with structured payloads.
- `qa:cycle` — compile → play → stop wait cycle (60s per step).
- `qa:sigint` — `runWait` interrupt path against a non-existent project
  (target=reachable to stay in the polling loop regardless of editor
  state). Schedules `process.emit("SIGINT")` 800 ms in; expects
  `kind: interrupted` and exit 130.
- `qa:crash` — taskkill the editor, reopen, and verify the
  `runtime.json.crashed.<pid>.<startedAtMs>.json` sidecar is written by
  the new session's `[InitializeOnLoad]` (B5 detection). Polls the
  sidecar file directly rather than gating on `--wait reachable`: the
  sidecar lands during `[InitializeOnLoad]` and finishes before IPC
  handler registration, so waiting for `reachable` would block on a
  downstream signal that arrives later than the actual signal under test.
- `qa:ceiling` — relaunch the editor with `UNICTL_RELOAD_THRESHOLD_MS=1`,
  expect `/liveness` to report `phase_override = unresponsive`, and
  expect `wait idle` to short-circuit with `kind = editor_unresponsive`
  (exit 3). Restores a healthy editor on cleanup.
- `qa:_default` (mise namespace default) orchestrates the four tasks
  sequentially and aggregates their JSON results.

---

## [0.7.2] - 2026-05-07

### Fixed (critical — v0.7.0 and v0.7.1 are broken on npm/UPM)

The release pipeline never rebuilt the native bridge before assembling
the UPM tarball. The bundled `Plugins/Windows/x86_64/unictl_native.dll`
in v0.7.0 and v0.7.1 was an Apr-2026 build that predates Phase A; the
`/liveness` route added in Phase A landed in Rust source but the
shipped DLL didn't carry it. As a result, **anyone installing v0.7.0
or v0.7.1 of the UPM package via Git URL gets `not_found` for every
`unictl wait`, `editor compile --wait`, and `/liveness` call** — the
C# side has the new code paths but the native end of the pipe
doesn't speak them.

v0.7.2 fixes the broken release path:

- `release.ts` now calls the platform-appropriate native build script
  (`scripts/build/build-native-windows.ps1` on Windows,
  `scripts/build/build-native-macos.sh` on macOS) **before** running
  assemble.
- A freshness assertion fails the release if any native binary under
  `packages/upm/com.unictl.editor/Plugins/` is older than the newest
  Rust source file. Cross-platform binaries (e.g. macOS `.dylib` from
  a Windows release host) must be rebuilt by their owning host before
  the next release; the assertion catches that gap explicitly rather
  than letting a stale binary ship silently.
- `native/unictl_native/Cargo.toml` version moved from `0.1.0` to track
  the unictl release version so binary ↔ source provenance is visible.
- `UnictlRuntimeJson.cs` C# Debug ambiguity fix: `using
  System.Diagnostics` (for `Stopwatch`) collided with `using
  UnityEngine` on `Debug.LogWarning`. The four call sites now fully
  qualify as `UnityEngine.Debug.LogWarning`. v0.7.0 / v0.7.1
  consumers saw this as `error CS0104` once Unity tried to compile
  the bundled UPM source.

Migration for affected installs: bump the UPM Git URL to `#v0.7.2`
and bump `bunx unictl@0.7.2` (or `npm i -g unictl@0.7.2`). Restart
Unity after the UPM upgrade so the new DLL loads.

### Fixed (dogfood discoverability)

- Removed the misleading `unictl command list` → `unictl describe-all`
  deprecation hint emitted in v0.7.0 / v0.7.1. The two commands are
  not equivalent and the deprecation overreach was incorrect:
  - `unictl command list` enumerates every `[UnictlTool]` registered
    at runtime — builtin tools (capture_ui, editor_log, execute_menu,
    ping, ugui_input, ui_toolkit_input, build_status, build_cancel,
    editor_control, build_project, test_run) plus all consumer-defined
    `[UnictlTool]` classes. It is the canonical runtime discovery
    channel and is NOT deprecated.
  - `unictl describe-all` returns static `DescribeMetadata` for the
    v0.7 verb-noun tree only (10 verbs after this patch). It does
    not require a running editor.
  Both remain. `MIGRATION.md` and `DEPRECATION.md` updated to drop
  the wrong row and call out the policy.
- `unictl command --describe` added: emits canonical
  `DescribeMetadata` for the `command` verb itself (when, when_not,
  examples, args). The verb is now first-class in the agent metadata
  tree alongside the v0.7 verbs, closing the discoverability gap that
  previously required reading C# source to learn the call shape.
- `unictl describe-all` now also includes the `command` verb metadata
  (10 verbs total) since `command` is permanent.

### Notes

- v0.7.0 and v0.7.1 will be marked `npm deprecate`d once v0.7.2 is
  live. Do not pin to those versions.
- Per-tool metadata (`unictl command <tool> --describe`) requires
  enrichment of the C# `[UnictlTool]` registry to expose param/action
  schemas through IPC; deferred to a future v0.7.x patch.
- Future minor: migrate the remaining 10 builtin `[UnictlTool]`s to
  verb-noun hosts so `command` narrows to consumer-defined
  registrations only. Tracked separately.

---

## [0.7.1] - 2026-05-07

> Broken on UPM — see v0.7.2 above. Do not install.

### Fixed
- Documentation: clarified that `unictl command` is the canonical
  dispatcher for consumer-defined `[UnictlTool]` classes and stays in
  the CLI permanently. v0.7.0's CHANGELOG / MIGRATION / DEPRECATION
  notes incorrectly stated "v1.0 will remove the legacy surface" —
  v1.0 removes only the *specific invocation patterns* that have a
  v0.7 verb-noun equivalent (`unictl command editor_control -p
  action=play|stop|compile|refresh`). The dispatcher itself, plus
  any custom tool registered via `[UnictlTool]` in a consumer Unity
  project, are not deprecated and are not affected by v1.0.
  *(v0.7.2 amendment: this entry incorrectly listed `command list`
  among the removed patterns. `command list` is the canonical
  runtime discovery channel and is NOT removed in v1.0. See v0.7.2
  Fixed section above.)*
- `--help --json` deprecation policy unchanged: replaced by
  `--describe` / `unictl describe-all` and removed in v1.0.
- No code changes; runtime behavior of `unictl command <tool>` is
  identical to v0.7.0 (matches the `suggestV07Mapping` logic in
  `cli.ts`, which only ever emitted hints for mapped invocations).

---

## [0.7.0] - 2026-05-06

v0.7.0 lands the verb-noun command tree, native heartbeat ABI, runtime liveness
descriptor, and lifecycle settings bundles. v0.6 invocations continue to work
unchanged. v0.7 introduces canonical agent metadata via `--describe` and a
wait engine for editor-state synchronization.

> Documentation correction in v0.7.1: the original v0.7.0 release notes
> stated "the legacy `unictl command` verb is deprecated; v1.0 will
> remove it." That claim was overbroad. v1.0 hard-removes only the
> specific invocation patterns that have a v0.7 verb-noun equivalent;
> the `unictl command` dispatcher itself stays in the CLI as the
> canonical path for consumer-defined `[UnictlTool]` classes. See
> v0.7.1 above and the corrected DEPRECATION.md for the precise policy.

See [MIGRATION.md](MIGRATION.md) and [DEPRECATION.md](DEPRECATION.md) for the
v0.6 → v0.7 migration path.

### Added

#### Phase A — Heartbeat ABI + native liveness
- `unictl_heartbeat` and `unictl_get_liveness` native exports (JSON-over-pipe;
  no shared C structs). Editor-side `UnictlHeartbeat.cs` emits 1Hz throttled
  + push-on-phase-change payloads with <4KB/s allocation budget.
- `GET /liveness` IPC route returns the canonical liveness envelope:
  `{schema_version, alive_ms_ago, last_heartbeat_ms, last_state, pid,
   handler_registered, phase_override, native_version}`.
- `phase_override` in `{never_seen, unresponsive, null}` lets agents
  distinguish cold start from an editor that has fallen behind the A4 30s
  reload ceiling.
- Phase enum precedence (highest first):
  `quitting > reloading > compiling > importing > playing > paused > idle`.

#### Phase B — `runtime.json` + PID guard
- `Library/unictl/runtime.json` writer (`UnictlRuntimeJson.cs`) exposes
  PID, started_at, project_root, transport, paths, native + UPM versions,
  Unity version, session id, platform, and `terminal_reason`.
- `terminal_reason="quit"` is written before graceful shutdown; the file
  is then best-effort deleted. Crash detection writes a sidecar
  `runtime.json.crashed.<pid>.<started>.json` for postmortem.
- CLI reader (`runtime.ts`) classifies state:
  `not_running | schema_unsupported | parse_failed | alive | died | pid_mismatch`
  with bounded retry against the F.2 atomic-rename window.
- `isPidAlive(pid)` cross-platform PID liveness via `process.kill(pid, 0)`.
- B6 PID-reuse guard: `alive` requires both a live PID AND a matching
  `project_root` to defend against PID recycling on long-running hosts.

#### Phase C — Verb-noun command tree
- New canonical verbs alongside `unictl command`:
  - `unictl editor compile | play | stop | refresh` (in-editor IPC; distinct
    from the existing batchmode `unictl compile`).
  - `unictl input set <legacy|new|both> [--restart]` — Input System handler.
  - `unictl scripting set <mono|il2cpp> --platform <P>` — scripting backend.
  - `unictl deploy android keystore set --path --alias` — keystore path/alias
    (passwords intentionally not persisted; supply at build time via env).
  - `unictl settings raw-set <key> <value> --no-warranty` — escape hatch.
  - `unictl wait <state> [--timeout T]` — block on editor state.
  - `unictl describe-all` — aggregate canonical agent metadata.
- `--describe` flag on every v0.7 verb emits canonical `DescribeMetadata`
  (schema_version, name, verb, noun, summary, when, when_not, args, examples,
  exit_codes, related, since_version, stability) and exits 0.
- `--json` defaults to ON for v0.7 verb-noun commands; `UNICTL_HUMAN=1` env
  or `--no-json` flag forces human output. Legacy v0.6 commands keep their
  existing default-off behavior. Centralized in `output.ts`.
- `unictl command` invocations of v0.7-mappable surfaces emit a one-line
  `[deprecated]` stderr suggestion (e.g. `command editor_control -p
  action=play` → `unictl editor play`). Behavior unchanged.

#### Phase D — Wait engine
- `unictl wait <state>` and editor sub-verbs `--wait` block until the
  editor reaches the target state or `--timeout` fires. Pull cadence
  250ms (F.7).
- F.3 default timeout matrix: `editor.compile.idle=120s`,
  `editor.play.playing=15s`, `editor.stop.idle=30s`,
  `editor.refresh.idle=90s`, `(any).reachable=120s`,
  `(any).reloading=30s`, `(any).quit=15s`.
- `parseDuration` accepts `30s | 2m | 1h | 120 (bare seconds) | 0 (unbounded)`.
- Env override: `UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB>_<STATE>` between flag
  and compiled default in precedence.
- Reload-aware re-arm (D6 + A4): when phase=`reloading` and target ≠
  `reloading`, the budget clock pauses; resumes on phase change. The A4
  30s ceiling is enforced via the `unresponsive` override which
  short-circuits to `editor_unresponsive` rather than silently consuming
  budget.
- SIGINT (Ctrl+C) during wait → exit 130, `kind: interrupted`.
- Liveness fast-fail: when `runtime.json` reports `not_running` or `died`
  and target ≠ `reachable`, return `editor_not_running` immediately
  (elapsed_ms 0).

#### Phase E — Settings lifecycle bundles
- Line-oriented YAML editor for `ProjectSettings.asset` preserves Unity's
  `%YAML 1.1` + `tag:unity3d.com` markers byte-for-byte (no normalization,
  no key reorder). Atomic writes via temp file + rename.
- Editor-closed gate (`requireEditorClosed`) on every settings command;
  `--restart` issues `editor_quit` IPC + 1.5s grace + recheck before
  mutating.
- `input set` / `scripting set` write to `activeInputHandler` and
  `scriptingBackend.<Platform>` (nested map; supports `Android`, `iOS`,
  `Standalone`, `WebGL`, `tvOS`, `PS4`, `PS5`, `XboxOne`, `Nintendo Switch`).
- `deploy android keystore set` writes path/alias and sets
  `androidUseCustomKeystore=1`. Passwords never persist to
  ProjectSettings.asset (Unity standard); response includes a `notes`
  array pointing to `UNITY_ANDROID_KEYSTORE_PASS` /
  `UNITY_ANDROID_KEYALIAS_PASS` env vars.
- `settings raw-set` requires `--no-warranty` (probed via
  `rawArgs.includes` to bypass citty/mri `--no-X` boolean negation).
  Top-level scalars only; dotted paths rejected (use feature bundles).

#### Phase F — Per-verb `--wait` integration
- `editor compile | play | stop | refresh` accept `--wait [<state>]`
  + `--timeout <duration>`. Bare `--wait` uses the verb-specific F.3
  default state. Response merges the IPC dispatch result with a `wait`
  block (`state, phase, alive_ms_ago, elapsed_ms`) on success.

#### Error envelope (v0.7)
- New structured envelope on v0.7 commands:
  `{ok, error: {code, kind, message, recovery, related, context, hint_command, hint_text}}`.
  Numeric `code` allocated per F.6 stride 0x1000 namespaces (special
  0x0001-0x000F, validation 0x0010-0x001F, editor 0x1000, build 0x2000,
  test 0x3000, profile 0x4000, ipc 0x5000 with heartbeat 0x5010-0x5012
  + reload 0x5020, project 0x6000, input/scripting/settings 0x7000,
  deploy 0x8000).
- New error kinds (since 0.7.0): `not_implemented` (exit 78),
  `editor_reload_active` (exit 3, CLI lane), `wait_timeout` (124),
  `interrupted` (130), `editor_unresponsive` (3), `project_root_invalid`
  (2), `setting_key_not_found` (2), `confirmation_required` (2),
  `secret_required` (2), `keystore_path_not_found` (2).

### Changed
- `unictl --help` lists the v0.7 verb-noun tree alongside the legacy verbs.
- `editor_reload_active` exit code on the CLI lane is now 3 (lane unavailable),
  matching the IPC lane semantics. The earlier exit-code 2 entry remains for
  the test verb's batch-mode preflight.
- v0.7 commands consistently emit the structured envelope through `output.ts`;
  legacy v0.6 verbs keep their existing per-call envelopes.

### Deprecated
- v0.6-style invocations of mapped builtins via `unictl command` are
  deprecated; v1.0 hard-removes them: `unictl command editor_control
  -p action=play|stop|compile|refresh` and `unictl command list`.
  v0.7 emits a one-line `[deprecated]` stderr suggestion on those
  mappable invocations. The `unictl command` dispatcher itself,
  builtin tools without a v0.7 equivalent, and any custom
  `[UnictlTool]` registered in a consumer Unity project remain
  invokable through `unictl command <tool>` indefinitely.
- `unictl <subcmd> --help --json` deprecated in v0.7 and removed in
  v1.0; replaced by `--describe` / `unictl describe-all`.
- (Documentation correction note: the v0.7.0 ship of this file
  briefly stated "the legacy `unictl command` verb itself is removed
  in v1.0". That was overbroad — see v0.7.1 above and DEPRECATION.md
  for the precise policy.)

### Plan + spike artifacts
- `docs/standalone/v0.7-plan.md` (planner + architect + critic synthesis)
  and `docs/standalone/v0.7-spikes/` (F.2-F.9 phase-0 outputs) document
  the design decisions backing this release.
- `docs/standalone/v0.7-adr/` consolidates per-phase implementation notes
  (A1, A2/A3, A4, A5, A7, B, B1, B7, C-skeleton, C-final, D, E, F).

### Pre-v0.7 housekeeping (still applies)
- Repo-local `AGENTS.md` and mise-based project runtime/task harness for
  agent sessions.
- Unity `.meta` GUID validation for the bundled UPM editor package to
  catch duplicate, placeholder, and low-entropy GUIDs before release.
- Release validation now runs the error registry drift check and Unity
  `.meta` GUID check before packaging.

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
