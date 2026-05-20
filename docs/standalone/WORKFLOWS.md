# unictl Workflows

Common operator tasks for `unictl@0.3.0+`.

## Quick start

```bash
# 1. Add the Unity editor package to the consumer project manifest
bunx unictl@latest init --project /abs/path/to/project

# 2. If the editor is closed, force package resolve + compile once
unictl compile --project /abs/path/to/project

# 3. Verify environment
bunx unictl@latest doctor --project /abs/path/to/project

# 4. Open the editor (or confirm it is already running)
unictl editor open --project /abs/path/to/project

# 5. List available built-in commands
unictl command list --project /abs/path/to/project

# 6. Trigger a build
unictl build --target StandaloneWindows64 --wait --project /abs/path/to/project
```

`init` is a manifest edit, not an editor-side command. Before `com.unictl.editor` has been
imported and compiled there is no IPC endpoint for `unictl` to call, so an already-open Editor
may need a Package Manager refresh/re-resolve or an editor restart before live commands work.
For deterministic first install checks, close the Editor and run `unictl compile`.

## Agent ready-state workflow

Use first-class ready-state commands instead of ad-hoc sleep loops or grepping
human help output.

```bash
# Open the editor and return only when IPC commands are reachable.
unictl editor open --wait reachable --timeout 300s --project /abs/path/to/project

# One-shot status snapshot for branching.
unictl editor status --project /abs/path/to/project

# Wait for a future state transition.
unictl wait idle --timeout 2m --project /abs/path/to/project

# Trigger compile/import and return only when the editor is idle again.
unictl editor compile --wait idle --timeout 5m --project /abs/path/to/project
```

`editor status` is the single ready-state snapshot for agents. Branch on the
machine-readable fields instead of parsing log text:

| Field | Meaning |
|-------|---------|
| `reachable` | IPC handler is registered and editor commands can be sent |
| `phase` | Current observed phase (`idle`, `playing`, `compiling`, `reloading`, etc.) |
| `is_compiling` | Unity reports script compilation in progress |
| `is_reloading_domain` | Domain reload is active or recently observed |
| `is_in_playmode` / `is_playing` | Play Mode state |
| `is_busy` / `busy_reasons` | Aggregated busy signal for compile/import/play/reload windows |

Preferred idioms:

```bash
# Good: command-owned wait.
unictl editor refresh --wait idle --timeout 2m --project /abs/path/to/project

# Good: generic state wait.
unictl wait reachable --timeout 30s --project /abs/path/to/project

# Avoid: shell sleep loops over guessed fields.
until unictl editor status | jq -e '.is_compiling == false'; do sleep 2; done
```

`unictl test` also owns its lane choice. Do not pre-check editor status just to
choose a test lane; use one command:

```bash
unictl test --platform editmode --results TestResults/results.xml --project /abs/path/to/project
```

If the editor is reachable, it uses the editor lane. If not, it auto-routes to
batchmode. Use `--batch` only when you intentionally require headless batchmode.

## Build lanes

`unictl` routes build requests automatically:

| Condition | Lane | Notes |
|-----------|------|-------|
| Editor running | IPC (named pipe / unix socket) | Fast; preserves editor state |
| Editor closed | Batchmode | Starts Unity headless |

Override the automatic selection when needed:

```bash
# Force IPC even if editor detection is ambiguous
unictl build --target StandaloneWindows64 --force-ipc --project /abs/path/to/project

# Force batchmode (e.g. CI environment)
unictl build --target StandaloneWindows64 --batch --project /abs/path/to/project
```

## Build profiles (Unity 6+)

`BuildProfile` assets are supported in Unity 6000.0+ and require batchmode:

```bash
unictl build \
  --target StandaloneWindows64 \
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
unictl build cancel --job-id <id> --project /abs/path/to/project
```

## Status polling

`unictl build --wait` streams normalized lifecycle states. When using
`--no-wait`, poll the returned `status_command` until `terminal=true` and
`state` is one of `succeeded`, `failed`, or `cancelled`:

```bash
unictl build status --job-id <id> --project /abs/path/to/project
```

Response fields include `state`, `raw_state`, `terminal`, `result_source`,
`result_confidence`, `elapsed_ms`, `report_summary`, and `error` when failed.
In CI, poll on a fixed interval (e.g. every 5 seconds) rather than tight-looping.

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
