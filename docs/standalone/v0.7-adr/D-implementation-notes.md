# Phase D Implementation Notes — `unictl wait`

Closes Phase D of the v0.7 plan: implements the `unictl wait <state>`
verb on top of the Phase A3 `/liveness` route, the Phase B5 `runtime.json`
reader, the F.3 timeout matrix, and the F.7 Pull cadence.

## Scope

| Plan item | Outcome |
|-----------|---------|
| D1 — Pull-loop core | 250ms cadence (per F.7), implemented in `runWait()` |
| D2 — State predicates | `idle | playing | compiling | reloading | reachable` per Phase A1 ADR |
| D3 — F.3 timeout matrix | `lookupTimeoutDefault(verb, state)` with env override `UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB>_<STATE>` |
| D4 — SIGINT handler | `process.once("SIGINT")` flips a flag; loop returns `interrupted` outcome → exit 130 |
| D5 — `wait_timeout` envelope | New error kind code 0x0002, exit 124 |
| D6 — Reload-aware re-arm | Pause clock when phase=reloading (unless target IS reloading); A4 ceiling enforced via `editor_unresponsive` short-circuit |
| D7 — Interrupted error | `kind: "interrupted"` code 0x0003, exit 130 |

## Files Touched

| File | Change |
|------|--------|
| `packages/cli/src/wait.ts` | NEW. Pull-loop engine, duration parser, timeout matrix, state predicates, outcome → envelope adapter. |
| `packages/cli/src/client.ts` | Added `liveness(opts)` GET `/liveness` helper. |
| `packages/cli/src/v07-commands.ts` | Replaced `wait` stub with full body: state validation, --timeout parsing, `runWait()` invocation, envelope emit. |
| `packages/cli/src/error-registry.json` | New kinds (since 0.7.0): `wait_timeout` (124), `interrupted` (130), `editor_unresponsive` (3). |
| `packages/cli/src/code-allocations.json` | New codes: `wait_timeout` 0x0002, `interrupted` 0x0003, `editor_unresponsive` 0x5021. |
| `packages/upm/com.unictl.editor/Editor/Unictl/Internal/HintTable.cs` | Editor-side hints for new kinds. |
| `packages/cli/src/describe.ts` | `wait` exit_codes updated to `[0, 2, 3, 124, 125, 130]`; stability bumped beta. |

## Behavior Contracts

### State semantics

| Target state | Match condition |
|--------------|----------------|
| `idle`, `compiling`, `reloading` | `last_state.phase` exact match |
| `playing` | phase is `playing` OR `paused` (still in Play mode) |
| `reachable` | `handler_registered === true` |

`phase_override` from `format_liveness_response` is honored:
- `"never_seen"` → no heartbeat ever arrived; `reachable` can still match if
  the IPC handler is registered because `/health` and `/command` are usable.
- `"unresponsive"` → past A4 30s ceiling; loop returns `editor_unresponsive`
  outcome (exit 3) unless target is `reachable` (which keeps polling).

### Timeout precedence (F.3)

1. `--timeout <duration>` flag (e.g. `30s`, `2m`, `1h`, `120`, `0`).
2. `UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB>_<STATE>` env var.
3. Compiled default from F.3 matrix.

`0` is unbounded. `--timeout` value parse failures return `invalid_param`
exit 2 before polling starts.

For top-level `unictl wait <state>`, the verb segment is `wait` (e.g.
`wait.idle`, `wait.reachable`). Future call sites layered on other verbs
(`unictl editor compile --wait idle`) plug their own `verb` into
`lookupTimeoutDefault`.

### Reload-aware re-arm

- When the loop observes `phase === "reloading"` AND the target is NOT
  `reloading`, the budget clock pauses for the duration of that observation.
- Once the next poll sees a non-reloading phase, the paused interval is
  added to `pausedMs` and the clock resumes.
- The A4 30s reload ceiling is enforced by the `unresponsive` override:
  a reload that exceeds 30s flips `phase_override` to `"unresponsive"` and
  the loop returns `editor_unresponsive` (exit 3) — never silently consumes
  budget.

### Outcome → exit code map

| Outcome | Exit code |
|---------|-----------|
| `reached` | 0 |
| `editor_not_running` | 3 |
| `editor_unresponsive` | 3 |
| `wait_timeout` | 124 |
| `ipc_error` | 125 |
| `interrupted` | 130 |
| `invalid_param` (state, timeout) | 2 |

## Smoke Verification

- `mise run check` — drift checks PASSED for new kinds (`wait_timeout`,
  `interrupted`, `editor_unresponsive`); HintTable + registry + code
  allocations all consistent.
- `bun build packages/cli/src/cli.ts --target=bun` — 22 modules bundled
  cleanly (no TS errors).
- `unictl wait foobar` → `kind:invalid_param exit 2`.
- `unictl wait idle --timeout fivemin` → `kind:invalid_param exit 2`.
- `unictl wait idle --describe` → DescribeMetadata (now exit_codes=`[0, 2, 3, 124, 125, 130]`).
- `unictl wait idle --timeout 1s --project <no-editor>` →
  `kind:editor_not_running exit 3 elapsed_ms:0`.
- `unictl wait reachable --timeout 1s --project <no-editor>` → polls,
  hits budget, returns `kind:wait_timeout exit 124 elapsed_ms:~1047`.

Live editor smoke (positive paths — `wait idle` reaches phase=idle,
`wait reachable` returns when handler comes online) requires a running
editor; deferred to QA pass.

## Out of Scope (Future Phases)

- `editor compile --wait idle` integration: the wait engine is reusable,
  but the actual `--wait` flag wiring on `editor.compile` etc. lives in
  Phase D2 of the per-verb integration backlog.
- `test editmode --wait` / `test playmode --wait`: same — engine reusable,
  hookup deferred.
- Crash-sidecar surfacing (`died` runtime status with `crashed.<pid>.json`):
  Phase B5 already writes the sidecar; surface in Phase D follow-up if
  diagnostics demand it.

## Tracking

Phase D closure on issue siren403/unictl#7. Phase E entry point: settings
lifecycle bundles (`input set`, `deploy android keystore set`,
`scripting set`, `settings raw-set`) — all currently stubs.
