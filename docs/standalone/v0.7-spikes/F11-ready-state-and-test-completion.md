# F11 ready-state and test completion preflight

Date: 2026-05-15

Related issues: #13, #14, #15

## Scope

This spike groups the remaining editor-control reliability reports as one
contract problem: agents need a single, machine-readable way to know whether
the editor is ready, whether an operation has merged with an in-flight editor
state change, and whether an asynchronous test job has finished.

## Sandbox preflight

Project:

```powershell
sandbox\UnictlSmokeProject
```

Commands run from the repository root:

```powershell
bun run ./packages/cli/src/cli.ts editor open --project sandbox\UnictlSmokeProject
bun run ./packages/cli/src/cli.ts editor status --project sandbox\UnictlSmokeProject
bun run ./packages/cli/src/cli.ts command editor_control -p action=status --project sandbox\UnictlSmokeProject
bun run ./packages/cli/src/cli.ts wait reachable --timeout 30s --project sandbox\UnictlSmokeProject
```

Observed:

- `editor status` returns process/transport/health only.
- `command editor_control -p action=status` returns the richer state snapshot:
  `is_playing`, `is_compiling`, `is_paused`, `domain_reload`,
  `run_in_background`, `unity_version`, and `platform`.
- `wait reachable` succeeds independently of heartbeat phase once the IPC
  handler is registered.

Conclusion: #14 is valid. The useful ready-state data already exists in the
UPM server, but it is not exposed through the first-class `editor status`
command that agents naturally use.

## `editor compile --wait` preflight

After touching the sandbox EditMode test script timestamp, this command was
run:

```powershell
bun run ./packages/cli/src/cli.ts editor compile --wait --timeout 60s --project sandbox\UnictlSmokeProject
```

Observed failure:

```json
{
  "ok": false,
  "action": "compile",
  "result": {
    "success": true,
    "message": "Compile requested",
    "data": {
      "is_compiling": true
    }
  },
  "state": "idle",
  "error": {
    "kind": "editor_unresponsive",
    "message": "Editor heartbeat is stale ..."
  }
}
```

The editor reached idle shortly after, and a later `wait idle` succeeded.

Conclusion: #13 should not be treated only as an IPC dispatch problem. The
current flow sends `editor_control compile` first and then runs the generic
heartbeat wait. During compile/import/domain reload, the heartbeat can become
temporarily stale even though the editor is healthy and the requested compile is
progressing. The fix should use richer state snapshots before and during
waiting, not only `/liveness`.

## Raw `test_run` preflight

Raw editor-lane test job:

```powershell
bun run ./packages/cli/src/cli.ts command test_run `
  -p platform=editmode `
  -p assembly=UnictlSmokeProject.Tests.EditMode `
  -p results_path=<absolute TestResults path> `
  -p job_id=<uuid> `
  --project sandbox\UnictlSmokeProject
```

Observed immediate response:

```json
{
  "ok": true,
  "job_id": "<uuid>",
  "state": "queued",
  "progress_file": "Library/unictl-tests/<uuid>.json",
  "editor_session_id": "<session>",
  "editor_pid": 42460
}
```

The progress file starts with a UTF-8 BOM and is pretty-printed JSON:

```text
EF BB BF 7B ...
{
  "state": "finished",
  ...
}
```

The top-level command still completes correctly:

```powershell
bun run ./packages/cli/src/cli.ts test --platform editmode `
  --filter assembly:UnictlSmokeProject.Tests.EditMode `
  --results sandbox\UnictlSmokeProject\TestResults\top-level-after-raw.xml `
  --timeout 30s `
  --project sandbox\UnictlSmokeProject
```

Observed:

```json
{
  "ok": true,
  "lane": "editor",
  "total": 1,
  "passed": 1,
  "job_id": "<uuid>",
  "progress_file": "<absolute path>"
}
```

Conclusion: #15 is valid for raw `command test_run`. The stable contract is
currently embedded in the first-class `unictl test` CLI loop, not in a reusable
raw job wait command. Agents that use raw `test_run` have to rediscover BOM
handling, JSON parsing, session checks, PID checks, timeout checks, and terminal
state mapping.

## Discovery preflight

```powershell
bun run ./packages/cli/src/cli.ts schema editor.compile
bun run ./packages/cli/src/cli.ts schema test
bun run ./packages/cli/src/cli.ts capabilities
```

Observed:

- `schema editor.compile` exists and documents `--wait`.
- `schema test` is missing (`schema_not_found`).
- `capabilities` documents `test_run`, but tells callers to poll
  `Library/unictl-tests/<job-id>.json` without a safe parser or wait wrapper.

Conclusion: the agent-discovery surface still points agents toward the fragile
raw progress-file workflow when they are not using top-level `unictl test`.

## Implementation order

1. Promote rich editor state to `unictl editor status`.
   - Preserve current process/transport/health fields.
   - Add IPC state fields when the endpoint is reachable:
     `reachable`, `is_compiling`, `is_reloading_domain`, `is_importing_assets`
     if available, `is_in_playmode`, `domain_reload`, and a normalized `phase`.
   - Keep failures non-fatal when only status is requested; include typed
     diagnostic context instead.

2. Add a reusable CLI-side editor wait primitive that can combine `/liveness`
   with `editor_control status`.
   - Treat compile/import/reload as progress, not immediate unresponsive
     failure, while the command-specific timeout budget remains active.
   - Include `observed_phase`, `reachable`, and retry guidance in wait errors.

3. Change `editor compile --wait` to merge with in-flight compile/import.
   - Preflight status before dispatch.
   - If already compiling/importing/reloading, skip or tolerate compile dispatch
     rejection and wait for idle.
   - If dispatch succeeds with `is_compiling=true`, wait using the richer state
     primitive instead of heartbeat-only logic.

4. Add a first-class raw job wait surface for editor test jobs.
   - Preferred shape: `unictl test wait <job-id> --project <path> --timeout <duration>`.
   - Reuse the existing `unictl test` progress parser logic.
   - Parse JSON, strip BOM, validate editor session and PID, detect stale
     running heartbeat, and emit a terminal envelope.
   - Do not block the Unity main thread from C# with `test_run --wait`.

5. Tighten discovery.
   - Add `schema test` and the test wait command schema.
   - Update `capabilities` and `docs/standalone/test-runner.md` so agents prefer
     `unictl test` or `unictl test wait`, not ad-hoc progress-file grep.

## Non-goals

- Do not add server-side `test_run --wait` in C# for this batch. Blocking inside
  the editor command handler risks starving the callbacks that complete the job.
- Do not remove the progress file; it remains a useful low-level artifact.
- Do not require agents to parse human `--help` for readiness or job completion.
