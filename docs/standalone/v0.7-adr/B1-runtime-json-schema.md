<!-- B1 — runtime.json schema (2026-05-06) -->

# B1 — `runtime.json` Schema

Phase B introduces `Library/unictl/runtime.json` — the per-project PID liveness descriptor written by the Unity-side managed agent and read by the CLI to distinguish "editor not running" from "editor unreachable".

## Path

`<project_root>/Library/unictl/runtime.json`

`Library/` is gitignored in every Unity project and is wiped when the user clears the Library cache, so runtime state correctly disappears with it. The `unictl/` subdirectory holds runtime ephemera distinct from `<project_root>/.unictl/` (the latter holds descriptor / endpoint files that may persist across Library clears).

## Schema (v1)

```json
{
  "schema_version": 1,
  "pid": 12345,
  "started_at_ms": 1730800000000,
  "project_root": "D:/workspace/unity/PickUpCat",
  "transport": "pipe",
  "pipe_path": "\\\\.\\pipe\\unictl-abc123def456",
  "socket_path": null,
  "native_version": "0.1.0",
  "editor_package_version": "0.7.0",
  "unity_version": "6000.4.1f1",
  "session_id": "<guid from UnictlServer.SessionId>",
  "platform": "WindowsEditor",
  "terminal_reason": "unknown"
}
```

### Field semantics

| Field | Type | Set when | Notes |
|-------|------|----------|-------|
| `schema_version` | int | always | per A5 versioning policy |
| `pid` | int | startup | `System.Diagnostics.Process.GetCurrentProcess().Id` |
| `started_at_ms` | int64 | startup | `Stopwatch.GetTimestamp()` ms (monotonic per R16); used to detect PID reuse |
| `project_root` | string | startup | normalized forward-slash path |
| `transport` | enum: `"pipe" \| "socket"` | startup | platform-driven |
| `pipe_path` | string \| null | startup | populated on Windows |
| `socket_path` | string \| null | startup | populated on Unix |
| `native_version` | string | startup | matches `env!("CARGO_PKG_VERSION")` from native bridge |
| `editor_package_version` | string | startup | matches UPM `package.json` version |
| `unity_version` | string | startup | `Application.unityVersion` |
| `session_id` | string (GUID) | startup | reuses `UnictlServer.SessionId`; stable across reload |
| `platform` | string | startup | `Application.platform.ToString()` |
| `terminal_reason` | enum: `"quit" \| "crash" \| "unknown"` | varies — see below | distinguishes graceful exit from crash |

### `terminal_reason` lifecycle

- **`"unknown"`** — initial value at startup. Indicates "session in progress" while the editor runs.
- **`"quit"`** — written by `OnBeforeQuit` / `EditorApplication.quitting` **before** the file is deleted (B4a). If a CLI reader observes this value it means "editor cleanly quit".
- **`"crash"`** — never written by the live editor. Inferred at the next startup (B5): if `runtime.json` exists with a stale PID and `terminal_reason != "quit"`, the previous session is recorded as `"crash"` in a sidecar before the new file overwrites.

The crash inference relies on the OS releasing the PID on process death. PID reuse is mitigated by the `started_at_ms` cross-check in B6 — readers verify both `pid` is alive **and** `started_at_ms` matches what they expect (or is recent).

### Sidecar on crash detection

```
Library/unictl/runtime.json.crashed.<previous_pid>.<previous_started_at_ms>.json
```

A literal copy of the previous session's `runtime.json` plus `terminal_reason: "crash"` and `detected_at_ms`. CLI tooling (`unictl doctor`) can enumerate sidecars to surface recent crashes; the live editor never reads them.

## Atomic write contract (per F.2)

Lockfile-on-rename matches existing `TestProgressFile.cs` / `BuildRunner.cs` pattern:

1. Serialize JSON to string.
2. `File.WriteAllText("runtime.json.tmp.<pid>", json)`.
3. `File.Move("runtime.json.tmp.<pid>", "runtime.json", overwrite: true)`.

`File.Move` is atomic on NTFS and APFS within a single volume. Cross-volume `Library/` (rare) is documented as unsupported in F.2 — readers retry on parse failure.

## Reader contract (B3)

CLI reader consumes `runtime.json` synchronously:

1. If file missing → `editor_not_running`.
2. If parse fails → retry up to 3x at 50ms backoff (handles theoretical mid-rename observation; F.2 atomicity makes this rare).
3. After parse: check PID alive via `process.kill(pid, 0)` (Node) or `kill(pid, 0)` (Unix) / `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` (Windows).
4. If PID dead → `editor_died` with the runtime.json contents (so `terminal_reason` is exposed to the caller).
5. If PID alive **and** `project_root` matches current → return runtime descriptor.
6. If PID alive **but** `project_root` mismatches → return `editor_pid_mismatch` (PID reuse — uncommon but possible).

## Versioning

Per A5: additive field changes do not bump `schema_version`. Required field additions, type changes, semantic shifts require major bump. v0.7 ships v1.

## Consumer-side compat

CLI tooling that only knows v1 must:
- Accept unknown fields without erroring.
- Reject `schema_version > 1` with `code: "schema_version_unsupported"`.
- Treat absent `terminal_reason` as `"unknown"`.

## Sample fixture

`docs/standalone/v0.7-adr/runtime-fixture.json` (committed alongside this ADR) — minimum-viable fixture for B3/B6 unit tests.
