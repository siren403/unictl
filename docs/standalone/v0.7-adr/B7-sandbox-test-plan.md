<!-- B7 sandbox test plan (2026-05-07) -->

# B7 — Sandbox Test Plan

Phase B's correctness depends on round-trip behavior between the Unity-side writer and the CLI-side reader across:
- Cold start
- Clean quit
- Crash (force-kill)
- PID reuse / project mismatch

These checks require a live Unity editor and run against `tools/unictl/sandbox/UnictlSmokeProject` per AGENTS.md sandbox rules.

This document specifies the test cases. The actual scripts land alongside other sandbox tooling under `tools/unictl/sandbox/scripts/` (or are integrated into Phase F validation gates) once an editor session is available.

## Test environment

- Project: `tools/unictl/sandbox/UnictlSmokeProject` (or any consumer with the package linked)
- Unity: 6000.x.y current LTS
- Platforms covered:
  - Windows (named pipe transport, `taskkill /F /PID` for crash simulation)
  - macOS (Unix socket transport, `kill -9 <pid>` for crash simulation)

## Test 1 — Cold start writes runtime.json

**Goal**: confirm B2 writer produces `runtime.json` within 500ms of editor start.

```
1. Ensure no existing Library/unictl/runtime.json (delete if present)
2. Start Unity editor against sandbox project
3. Wait up to 5s, polling for Library/unictl/runtime.json
4. Assert file appears < 500ms after editor reaches the play button being responsive
5. Parse JSON, assert all required fields present per B1 schema
6. Assert terminal_reason == "unknown"
7. Assert pid is alive (matches Unity editor PID)
8. Assert project_root matches sandbox project absolute path (forward-slash normalized)
```

Pass criteria: all assertions hold. Fail mitigation: increase startup window to 2s if cold-compile pushes init past 500ms; revisit if > 2s.

## Test 2 — Clean quit writes terminal_reason="quit" then deletes

**Goal**: confirm B4a writes "quit" before B4b deletes.

```
1. With editor running and runtime.json present (from Test 1)
2. Use unictl CLI to invoke File > Quit equivalent (or send the editor SIGTERM equivalent)
3. Race-window window: between B4a write and B4b delete (very narrow, ~ ms)
4. Assert: at editor process exit, runtime.json is either absent (delete succeeded)
   OR present with terminal_reason="quit" (delete failed best-effort)
5. Re-start editor against same sandbox; assert no crash sidecar was recorded
   (because terminal_reason was "quit")
```

Pass criteria: no crash sidecar. Either deletion or "quit" content acceptable.

## Test 3 — Crash detection writes sidecar

**Goal**: confirm B5 records crash sidecar when previous session ended without quit.

```
Windows:
1. Start editor against sandbox
2. Wait for runtime.json
3. taskkill /F /PID <editor_pid>
4. Verify Library/unictl/runtime.json still on disk with terminal_reason != "quit"
5. Re-start editor
6. Assert Library/unictl/runtime.json.crashed.<old_pid>.<old_started>.json exists
7. Sidecar contains crash_inferred_terminal_reason: "crash" and detected_at_ms
8. New runtime.json overwrote the old (current pid != old pid)

macOS:
Same as Windows but step 3 is `kill -9 <editor_pid>`.
```

Pass criteria: sidecar exists with correct fields on both platforms.

## Test 4 — Reader returns "alive" for running editor

**Goal**: confirm B3 + B6 reader correctly classifies a healthy editor.

```
1. Editor running, runtime.json on disk with terminal_reason="unknown"
2. CLI invokes getRuntimeStatus(projectRoot)
3. Assert status === "alive"
4. Assert runtime.pid matches editor PID via OS-level check
5. Assert runtime.project_root matches projectRoot (after normalization)
```

Pass criteria: alive status + all fields populated.

## Test 5 — Reader returns "died" after force-kill

**Goal**: confirm B3 reader returns "died" when PID is dead but file remains.

```
1. Editor running, runtime.json present
2. taskkill /F or kill -9 the editor (do NOT restart yet)
3. CLI invokes getRuntimeStatus(projectRoot)
4. Assert status === "died"
5. Assert runtime.terminal_reason !== "quit" (it remains "unknown")
```

Pass criteria: died status returned without restart.

## Test 6 — Reader returns "pid_mismatch" on PID reuse

**Goal**: confirm B6 PID guard catches PID reuse.

This test is harder to simulate naturally — relies on PID recycling. Synthetic:

```
1. Take a known-running unrelated process PID (e.g. spawn a sleep process)
2. Hand-write a runtime.json with that PID and a different project_root
3. CLI invokes getRuntimeStatus(actualSandboxRoot)
4. Assert status === "pid_mismatch"
5. Assert expected_root === actualSandboxRoot
6. Assert runtime.project_root !== actualSandboxRoot
```

Pass criteria: pid_mismatch status returned.

## Test 7 — Reader returns "not_running" when file missing

**Goal**: trivial sanity check.

```
1. Ensure Library/unictl/runtime.json absent
2. CLI invokes getRuntimeStatus(projectRoot)
3. Assert status === "not_running"
```

## Test 8 — Reader returns "schema_unsupported" for future schema

**Goal**: confirm forward-compat policy.

```
1. Hand-write runtime.json with schema_version: 99
2. CLI invokes getRuntimeStatus(projectRoot)
3. Assert status === "schema_unsupported"
4. Assert observed === 99 and supported === 1
```

## Test 9 — Concurrent reader during writer rename

**Goal**: confirm F.2 atomic-rename + 3-attempt retry tolerates the race.

```
1. Editor running with steady runtime.json
2. Trigger a manual rewrite (force a phase transition or invoke a debug menu item that re-emits)
3. Concurrently spawn 100 reader invocations
4. Assert: 100% of reads return parseable runtime (no parse_failed status)
```

Pass criteria: zero parse failures across 100 reads.

## Integration into mise / CI

Once the scripts exist, hook into `mise run check:heartbeat` (per Phase A cross-phase concerns). The aggregator runs A6 + B7 + D8 sandbox tests in CI matrix (Windows + macOS).

## Deferred

This document is the spec. The scripts (Bun + PowerShell wrappers, or equivalent) are written when the sandbox is bootstrapped for live testing. Phase F release validation cannot ship green without B7 implementation.
