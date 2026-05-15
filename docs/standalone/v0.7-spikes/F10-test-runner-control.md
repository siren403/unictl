# F.10 -- Stable Test Runner Control Contract

Spike output for issue #1 and the test-runner stability follow-up.

Goal: make `unictl test` reliable for both EditMode and PlayMode by treating
test execution as a controlled job with explicit preflight, progress, terminal
state, and result validation. Do not depend on Unity's native process exit code
alone.

---

## Current implementation

### Batch lane

`unictl test --batch` already avoids Unity's unreliable direct test CLI path.
Instead of `-runTests -testPlatform ...`, the CLI launches Unity with:

```text
-executeMethod Unictl.BatchTestRunner.RunFromCommandLine
```

The UPM package entrypoint uses `UnityEditor.TestTools.TestRunner.Api`:

- `TestRunnerApi.Execute(new ExecutionSettings(filter) { runSynchronously = true })`
- `RunFinished` calls `TestRunnerApi.SaveResultToFile(...)`
- `RunFinished` calls `EditorApplication.Exit(exitCode)`

CLI terminal detection for batch lane currently combines:

- Unity process exit
- CLI wall-clock timeout
- editor log / stderr crash pattern checks
- NUnit XML existence
- NUnit XML parseability
- `<test-run>` summary fields

This satisfies the core workaround requested in #1, but it is under-documented
and not yet framed as the stable contract.

### Editor lane

When the editor is running, `unictl test` uses IPC `test_run`:

- editor preflight rejects unsafe PlayMode states before starting
- editor creates `Library/unictl-tests/<job-id>.json`
- CLI polls the progress file
- editor heartbeat updates `last_update_ms`
- terminal states are `finished` or `failed`
- CLI also verifies editor PID and editor session id

This gives stronger observability than batch lane, but completion detection is
separate from the generic `unictl wait` state machine.

---

## Stability risks

1. **Lane-selection ambiguity**

   Code auto-falls back to batch lane when no editor is reachable, but older
   docs still say the default path returns `editor_not_running`. Agents should
   know exactly which lane ran.

2. **Timeout grammar drift**

   `unictl wait` accepts `30s`, `2m`, `1h`, bare seconds, and `0`.
   Before this spike, `unictl test` parsed timeout with `parseInt`, so `5m`
   silently became `5` seconds. This was a high-risk automation footgun.

3. **Progress heartbeat false positives**

   Before this spike, editor lane treated `running` jobs with no progress update
   for 5 seconds as `test_heartbeat_stale`. That caught hangs quickly, but was
   too aggressive when the editor update loop was throttled or the Test Runner
   was inside a long synchronous section.

4. **Batch lane has no progress file**

   Batch lane can only observe process exit + XML. That is acceptable for now
   because batch runs in a dedicated Unity process, but it means there is no
   mid-run progress contract comparable to editor lane.

5. **No first-class test wait state**

   `unictl wait idle` can observe editor state, but it does not know about a
   test job id or `Library/unictl-tests/<job-id>.json`. Test completion must
   remain tied to the test command until a job-aware wait surface exists.

---

## Proposed contract

### Lane output

Every successful `unictl test` result should identify the lane:

```json
{
  "ok": true,
  "lane": "batch",
  "platform": "editmode",
  "results_file": "...",
  "duration_ms": 1234
}
```

For editor lane, include:

```json
{
  "lane": "editor",
  "job_id": "...",
  "progress_file": "Library/unictl-tests/<job-id>.json"
}
```

### Timeout grammar

`unictl test --timeout` should use the same parser as `unictl wait`:

| Input | Meaning |
|-------|---------|
| `30s` | 30 seconds |
| `2m` | 120 seconds |
| `1h` | 3600 seconds |
| `120` | 120 seconds |
| `0` | unbounded |

Invalid timeout input must fail fast with `invalid_param`.

### Editor-lane heartbeat

Keep heartbeat stale detection, but make the threshold explicit and eventually
configurable:

- default: 30 seconds, aligned with the domain reload ceiling
- future env override: `UNICTL_TEST_HEARTBEAT_STALE_AFTER`
- failure context should include `job_id`, `progress_file`, `last_update_ms`,
  and `stale_ms`

### Batch-lane terminal criteria

Batch lane is terminal only when one of these happens:

- timeout fires and Unity process is killed
- Unity process exits and NUnit XML is readable
- Unity process exits and XML is missing/unparseable, producing
  `xml_parse_failed`
- Unity process exits abnormally or log indicates crash, producing
  `unity_crash`

`--results` must not be inside the Unity project `Temp/` directory. In a
sandbox spike, `BatchTestRunner` logged that XML was saved to `Temp`, but the
file was gone by the time the CLI checked it because Unity cleaned project
temporary state during batch lifecycle shutdown.

Native Unity exit code is supporting evidence, never the sole success signal.

---

## Implementation sequence

1. Done: align `unictl test --timeout` with the `wait` duration parser.
2. Done: add `lane`, and for editor lane `job_id` / `progress_file`, to
   success output.
3. Done: update test-runner docs to state that batch EditMode uses the bundled
   `BatchTestRunner` executeMethod entrypoint.
4. Done: raise editor-lane heartbeat stale default from 5s to 30s and include
   structured stale context.
5. Done: add a sandbox EditMode NUnit fixture and verify:
   - batch EditMode via executeMethod
   - editor-lane EditMode job progress completion
6. Next: add automated smoke scripts for:
   - repeatable batch/editor EditMode verification
   - PlayMode preflight rejection with domain reload context
7. Consider a future `unictl test status <job-id>` or `unictl wait test`
   surface only after the progress-file contract is stable.

---

## Acceptance for #1

- Batch EditMode path is documented as `-executeMethod` + `TestRunnerApi`.
- CLI output makes the selected lane explicit.
- Timeout parsing cannot misread `5m` as `5s`.
- `--results` under project `Temp/` is rejected before launching Unity.
- Current sandbox batch EditMode smoke passes with `lane=batch`.
- Current sandbox editor-lane EditMode smoke passes with `lane=editor`,
  `job_id`, and `progress_file`.
