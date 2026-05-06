<!-- Phase B implementation notes — runtime.json writer + reader (2026-05-07) -->

# Phase B — Implementation Notes

Phase B lands `runtime.json` per the B1 schema, the Unity-side writer + crash detection, the CLI-side reader + PID guard, and the sandbox test plan (B7) for the live editor verification.

## Files added

| Path | Phase task | Purpose |
|------|-----------|---------|
| `tools/unictl/docs/standalone/v0.7-adr/B1-runtime-json-schema.md` | B1 | Schema spec |
| `tools/unictl/docs/standalone/v0.7-adr/runtime-fixture.json` | B1 | Sample fixture |
| `tools/unictl/packages/upm/com.unictl.editor/Editor/Unictl/Internal/UnictlRuntimeJson.cs` | B2, B4a, B4b, B5 | Writer + crash detection |
| `tools/unictl/packages/cli/src/runtime.ts` | B3, B6 | Reader + PID guard |
| `tools/unictl/docs/standalone/v0.7-adr/B7-sandbox-test-plan.md` | B7 | Test plan (deferred to live editor) |
| `tools/unictl/docs/standalone/v0.7-adr/B-implementation-notes.md` | (this) | Phase B summary |

## B2 — Writer

`UnictlRuntimeJson.cs` runs at `[InitializeOnLoad]` with priority before `UnictlServer` (alphabetical class-name order). Behavior:

1. Resolves `<projectRoot>/Library/unictl/` (creates if missing).
2. **B5 first**: if `runtime.json` already exists, sniffs for `terminal_reason: "quit"`. If absent → records the previous session as a crash sidecar (`runtime.json.crashed.<pid>.<started_at_ms>.json`).
3. Captures `s_startedAtMs` from `Stopwatch.GetTimestamp()` (R16 monotonic clock).
4. Writes `runtime.json` with `terminal_reason: "unknown"` via tmp-and-rename (F.2 lockfile-on-rename strategy, matches existing `TestProgressFile.cs` / `BuildRunner.cs` pattern).
5. Subscribes `OnEditorQuitting` for the B4a path.

The writer hand-rolls JSON to avoid pulling in `Newtonsoft.Json` for a hot path that runs once per editor session. Field order in the emitted JSON matches the B1 schema for human readability.

## B4a — Clean teardown

`OnEditorQuitting` rewrites `runtime.json` with `terminal_reason: "quit"` **before** any delete attempt. This is the race-free path: a CLI reader catching the file mid-shutdown sees the clean-quit signal regardless of whether the subsequent delete succeeded.

## B4b — Best-effort delete

After the quit-write, the writer attempts `File.Delete(runtimePath)`. Failure is non-fatal — the next startup will overwrite. If the next session reads `terminal_reason: "quit"` from the leftover file, B5's crash sniff correctly identifies it as a clean prior exit (no sidecar emitted).

## B5 — Crash detection

At startup, before the new write, the writer checks for an existing `runtime.json`:

- If absent → no crash to record, proceed to write.
- If present and contains `"terminal_reason":"quit"` → previous session ended cleanly; proceed to overwrite without sidecar.
- Otherwise → previous session ended without quit (crash, force-kill, OS shutdown). Record sidecar with the previous file contents annotated as `crash_inferred_terminal_reason: "crash"` and `detected_at_ms`. Then proceed to overwrite.

Sidecars are filed under `Library/unictl/` with names like `runtime.json.crashed.12345.1730800000000.json`. They are **never read** by the live editor — they exist for diagnostic tools (future `unictl doctor` enhancements) to enumerate recent crashes.

The crash inference does not verify previous PID liveness from the writer side. If the previous editor is somehow still running (unusual: same project, same `Library/`, two editor instances), the live editor will still write its own `runtime.json` and the reader-side B6 guard catches the PID/project mismatch. The `feedback_editor_multiproject` rule still applies as a runtime warning.

## B3 — Reader

`runtime.ts` exposes:

- `runtimeJsonPath(projectRoot)` — path resolver
- `readRuntimeJsonSync(projectRoot, opts)` — bounded-retry parse (default 3 attempts at 50ms)
- `isPidAlive(pid)` — `process.kill(pid, 0)` liveness check (works on Windows + Unix; signal 0 does not actually signal)
- `getRuntimeStatus(projectRoot, opts)` — discriminated-union result combining all of the above

`getRuntimeStatus` returns one of:

```
{ status: "not_running",     reason: "no_runtime_file" }
{ status: "schema_unsupported", reason: "schema_version_above_supported", observed, supported }
{ status: "parse_failed",    reason: "could_not_parse", attempts }
{ status: "alive",           runtime }
{ status: "died",            runtime }       // PID dead — terminal_reason in runtime field
{ status: "pid_mismatch",    runtime, expected_root }
```

This shape is the contract for downstream Phase D (`--wait`) integration. Callers branch on `status` and never need to manually combine PID liveness + parse + project-root match.

## B6 — PID guard

After the parse + PID liveness check succeeds, `getRuntimeStatus` compares the recorded `project_root` (normalized to forward-slash, lowercase) against the caller's `projectRoot`. Mismatch returns `pid_mismatch` with the runtime payload so callers can surface the conflict.

PID reuse is uncommon but real on long-running CI hosts (R6 in the plan). The `started_at_ms` field in the schema mitigates further: callers can persist their own `last_seen_started_at_ms` and treat a step backward as evidence of restart.

## Schema versioning

Per A5: v1 ships with the field set above. Adding fields is non-breaking. Removing or renaming bumps `schema_version` to a major. Reader-side `schema_unsupported` branch fires when `schema_version > 1`.

## `mise run check` results

```
Registry kinds:   46
Drift check PASSED: registry, HintTable, and code are consistent.
Capabilities drift check PASSED: capabilities.json kinds and version are consistent.
Unity .meta GUID validation passed.
```

Phase B does not add any new error registry entries. New error codes (e.g. `editor_pid_mismatch`, `editor_runtime_schema_unsupported`) are deferred to Phase C9 numeric allocation. CLI consumers branching on the discriminated-union `status` field do not need numeric codes for v0.7.

## Deferred

- B7 sandbox tests are documented but require a live editor session — see `B7-sandbox-test-plan.md`. Will run during sandbox bring-up before Phase F release validation.
- C# compile cannot be verified from the CLI agent environment. Unity creates the `.meta` file on next editor open per AGENTS.md `.meta` rules.
- CLI integration: existing `process.ts::getUnityPid` continues to work as a fallback for callers not yet migrated. Phase D `--wait` will be the first consumer of `getRuntimeStatus` directly.

## Verification summary

- `runtime.ts` import test: ✅ exports all expected symbols
- `bun run check`: ✅ green (error-registry + meta-guids both pass)
- C# compile: deferred to next Unity editor open
- Live writer/reader round-trip: deferred to B7 sandbox test
