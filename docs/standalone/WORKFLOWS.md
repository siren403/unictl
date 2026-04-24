# unictl Workflows

Common operator tasks for `unictl@0.3.0+`.

## Quick start

```bash
# 1. Verify environment
bunx unictl@latest doctor --project /abs/path/to/project

# 2. Open the editor (or confirm it is already running)
unictl editor open --project /abs/path/to/project

# 3. List available built-in commands
unictl command list --project /abs/path/to/project

# 4. Trigger a build
unictl command build_project -p target=StandaloneWindows64 --project /abs/path/to/project
```

## Build lanes

`unictl` routes build requests automatically:

| Condition | Lane | Notes |
|-----------|------|-------|
| Editor running | IPC (named pipe / unix socket) | Fast; preserves editor state |
| Editor closed | Batchmode | Starts Unity headless |

Override the automatic selection when needed:

```bash
# Force IPC even if editor detection is ambiguous
unictl command build_project -p target=StandaloneWindows64 --force-ipc --project /abs/path/to/project

# Force batchmode (e.g. CI environment)
unictl command build_project -p target=StandaloneWindows64 --batch --project /abs/path/to/project
```

## Build profiles (Unity 6+)

`BuildProfile` assets are supported in Unity 6000.0+ and require batchmode:

```bash
unictl command build_project \
  --build-profile Assets/Settings/Profiles/Release.asset \
  --batch \
  --project /abs/path/to/project
```

> Note: `--build-profile` is incompatible with `--force-ipc`. Batchmode is required because
> BuildProfile assets are resolved by the Unity build pipeline outside of editor play-state.

## Cancel a queued build

`build_cancel` performs a cooperative cancellation at the queue stage. A build already running
inside `BuildPipeline.BuildPlayer` cannot be interrupted mid-flight.

```bash
# Cancel by job ID returned from build_project
unictl command build_cancel -p job_id=<id> --project /abs/path/to/project
```

## Status polling

Poll `build_status` until the job reaches a terminal state (`succeeded`, `failed`, `cancelled`):

```bash
unictl command build_status -p job_id=<id> --project /abs/path/to/project
```

Response fields include `state`, `exit_code`, and `error` (when failed). In CI, poll on a
fixed interval (e.g. every 5 seconds) rather than tight-looping.

## Headless compile

`unictl compile` runs a Unity script compilation in batchmode and exits with a structured code:

| Exit code | Meaning |
|-----------|---------|
| 0 | Compile succeeded |
| 1 | Compile failed (errors in output) |
| 3 | Unity not found or lane unavailable |
| 124 | `--wait` client timeout exceeded |

```bash
unictl compile --project /abs/path/to/project
```

## Error recovery

Every error response from `unictl` carries a `hint` field that describes the likely cause and
next action. Example:

```json
{
  "ok": false,
  "error": {
    "kind": "target_unsupported",
    "message": "Build target 'WebGL' requires the WebGL module.",
    "hint": "Install the WebGL build support module via Unity Hub and retry."
  }
}
```

For the full table of error kinds, exit codes, and hints see
[error-reference.md](error-reference.md).
