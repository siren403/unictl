# Phase F Implementation Notes — per-verb `--wait` integration

Closes Phase F of the v0.7 plan: integrates the `wait` engine
(packages/cli/src/wait.ts, Phase D) into the editor sub-verbs so users
can dispatch + block in one call.

## Scope

| Verb | F.3 default state | F.3 default timeout |
|------|-------------------|---------------------|
| `unictl editor compile` | `idle` | 120s |
| `unictl editor play` | `playing` | 15s |
| `unictl editor stop` | `idle` | 30s |
| `unictl editor refresh` | `idle` | 90s |

`unictl build` and `unictl test` are intentionally NOT touched in this
phase — they already have their own batchmode wait semantics that are
orthogonal to editor-state polling. Integrating those is its own future
backlog item.

## CLI Contract

```
unictl editor <verb> [--wait [<state>]] [--timeout <duration>]
```

- `--wait <state>` — explicit target state (`idle | playing | compiling | reloading | reachable`).
- `--wait` alone — uses the verb-specific F.3 default state.
- `--timeout` — duration (`30s` / `2m` / `1h` / `120` bare seconds / `0` unbounded). Falls back to F.3 matrix default per `(verb, state)`.
- Omitted `--wait` — fire-and-forget, returns immediately after IPC dispatch (preserves v0.7 C-skeleton behavior).

### citty/mri arg-bind workaround

citty's string args require a value, so `--wait --timeout 30s` on the
command line causes `--timeout` to be consumed as the value of `--wait`.
The implementation probes `rawArgs` directly:

- Find index of `--wait`. If the next token is absent or starts with
  `--`, treat as default-state form (pull verb default from
  `EDITOR_DEFAULT_WAIT_STATE`).
- Otherwise trust citty's `args.wait` binding for the explicit state.

The same trick applies to `--timeout` recovery — when citty has lost
the timeout value to `--wait`, we re-probe `rawArgs.indexOf("--timeout")`
and pull its successor as the duration. This keeps the documented UX
intact without renaming flags.

## Response Envelopes

### Success (state reached)

```json
{
  "ok": true,
  "action": "compile",
  "result": { /* editor_control IPC result */ },
  "wait": {
    "state": "idle",
    "phase": "idle",
    "alive_ms_ago": 47,
    "elapsed_ms": 1234
  }
}
```

### Failure (wait failed after IPC succeeded)

```json
{
  "ok": false,
  "action": "compile",
  "result": { /* the IPC dispatch DID succeed; surface for diagnostics */ },
  "state": "idle",
  "elapsed_ms": 0,
  "error": {
    "code": 4098,
    "kind": "editor_not_running",
    "exit_code": 3,
    /* … full v0.7 envelope … */
  }
}
```

### Failure (IPC dispatch itself failed)

Same as today: `kind: "ipc_error"` exit 125. The wait never engages.

## Files Touched

| File | Change |
|------|--------|
| `packages/cli/src/v07-commands.ts` | `makeEditorActionCommand()` extended with `wait` + `timeout` args; rawArgs probe for `--wait` alone; post-IPC `runWait()` integration; merged response envelope. `EDITOR_DEFAULT_WAIT_STATE` map added. |
| `packages/cli/src/describe.ts` | New `EDITOR_WAIT_ARGS` block; `editor.compile`/`play`/`stop`/`refresh` describe entries gain `args: [...COMMON_ARGS, ...EDITOR_WAIT_ARGS]`; exit_codes updated to `[0, 2, 3, 124, 125, 130]`; examples extended with `--wait` forms. |

No new error kinds, no schema bumps, no changes to `wait.ts`/`runtime.ts`.

## Smoke Verification

Drift + bundle:
- `mise run check` — registry / HintTable / code-allocations consistent.
- `bun build cli.ts` — 24 modules clean.

Validation paths:
- `editor compile --wait foobar` → `invalid_param` exit 2 ✔
- `editor compile --wait idle --timeout fivemin` → `invalid_param` exit 2 ✔
- `editor compile --describe` → metadata reflects new args + exit_codes ✔

End-to-end against PickUpCat (live editor without Phase B5 runtime.json):
- `editor compile --wait --timeout 1s` → IPC dispatched ("Compile requested"), wait fast-fails `editor_not_running` exit 3 ✔
- `editor play --wait --timeout 1s` → IPC ("Play mode requested"), wait state=`playing` (verb default), fast-fail ✔
- `editor compile --wait reachable --timeout 1s` → IPC dispatched, wait polls for ~1050ms, returns `wait_timeout` exit 124 ✔
- `editor compile` (no --wait) → fire-and-forget, returns immediately ✔

The fast-fail path is exercised because PickUpCat's running editor uses
an older unictl UPM build that predates Phase B5's `UnictlRuntimeJson.cs`
writer. Once the editor restarts and picks up the latest UPM submodule,
runtime.json will appear at `Library/unictl/runtime.json` and the wait
loop will progress beyond the fast-fail (positive paths exercised in
QA, not this implementation pass).

## Out of Scope

- **`unictl build --wait <state>`** — the build verb already has its own
  `--wait` semantics tied to the build job lifecycle, not editor state.
  Disambiguating those is a deliberate non-goal here.
- **`unictl test editmode|playmode --wait <state>`** — same reasoning;
  test wait is currently job-completion polling, not editor-state.
- **Auto-restart after `editor stop --wait idle`** — wait surfaces the
  reload window via the A4 30s ceiling; explicit relaunch stays a
  user-driven `unictl editor open` step.

## Tracking

Phase F closure on issue siren403/unictl#7. With this PR all canonical
v0.7 surface verbs are functional and waitable. Remaining v0.7 items:

- Documentation pass: migration table, `describe-all` reference,
  v0.6 → v0.7 walkthrough.
- v0.7.0 release: `mise run release:dry-run -- 0.7.0` → tag + npm push.
- v1.0: hard removal of `unictl command` and `--help --json`.
