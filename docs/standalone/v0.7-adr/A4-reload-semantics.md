<!-- A4 — Reload semantics implementation notes (2026-05-06) -->

# A4 — Reload Semantics

Phase A4 lands the reload-window contract from A1 ADR + F.9: `/liveness` is the only IPC route that answers while `HANDLER` is None; all other routes return an `editor_reload_active` envelope so callers can retry instead of hanging.

## Files changed

| Path | Change |
|------|--------|
| `tools/unictl/native/unictl_native/src/lib.rs` | `handle_command` returns `editor_reload_active` envelope when `HANDLER` is None; removes the v0.6 MAIN_QUEUE deferred-accept path |
| `tools/unictl/docs/standalone/v0.7-adr/A4-reload-semantics.md` | new — this document |

## Behavior matrix

| Route | `HANDLER` registered | `HANDLER` None (during reload) |
|-------|----------------------|--------------------------------|
| `GET /health` | 200 `{status:"ok",handler_registered:true}` | 200 `{status:"ok",handler_registered:false}` (probe-only, unchanged) |
| `GET /liveness` | 200 with current state | **200** with `phase: "reloading"` from last managed push, or `phase_override: "unresponsive"` after threshold |
| `POST /command` | normal handler invocation | **`{ok:false, code:0, kind:"editor_reload_active"}`** envelope (was: `{accepted:true, deferred:true}`) |
| 404 | 404 envelope | 404 envelope |

The HTTP status codes referenced in the plan ("503 with code/kind") are envelope-level, not transport-level — Windows named pipes don't carry HTTP status, so the existing protocol uses `{ok, code, kind}` envelope shape uniformly across both transports.

## Breaking change vs v0.6

The v0.6 protocol returned `{accepted:true, deferred:true, id:"..."}` for any `/command` invocation while `HANDLER` was None, then drained the request from `MAIN_QUEUE` after handler re-registration. v0.7 removes that path:

- **Old behavior**: client posts during reload → silent queue → response delivered after reload completes (could be 1-15s+ wait).
- **New behavior**: client posts during reload → immediate `editor_reload_active` envelope → client polls `/liveness`, retries when `phase != "reloading"`.

This is intentional. The new path:
- Surfaces "editor is reloading" to the client clearly (no silent hang).
- Pairs naturally with `--wait` (the F.7 polling loop already handles `editor_reload_active` retry transparently).
- Removes a class of confusing UX where a `unictl command ...` invocation appears to hang for unknown reasons.

Migration impact:
- v0.7 CLI handles this transparently (Phase D `--wait` polls `/liveness`).
- Direct IPC consumers (rare in practice — the CLI is the primary client) must add a retry loop. The migration guide in F1 will document this.

## Numeric error code

`code: 0` placeholder. Phase C9 allocates the real value from the `ipc_*` namespace per F.6 (likely 0x5020 or next free in `ipc_*` after the heartbeat-domain codes 0x5010-0x5012). The `kind: "editor_reload_active"` slug is the stable identifier; clients should branch on `kind` not numeric code until C9 lands.

## Why `/health` stays 200

`/health` is a transport probe (does the pipe respond?). It existed in v0.6 and consumers (including `unictl doctor`) rely on it returning 200 even when the editor is in a transitional state. Flipping it to 503 during reload would break those probes.

The `handler_registered: false` field already signals "managed handler not currently attached" — clients can branch on that without needing the route to error out. The `/liveness` route is the new canonical "is editor truly alive" check.

## MAIN_QUEUE drain path

The MAIN_QUEUE drain (`unictl_pop_main` + managed `ProcessMainQueue`) is unchanged for the call-handler-while-registered path. `call_handler` still pushes to MAIN_QUEUE for async commands when `HANDLER` is Some.

What's removed: the path that pushed to MAIN_QUEUE when `HANDLER` was None. Items are no longer queued during reload — clients retry instead. This simplifies the queue's lifecycle (no items survive across reload boundary).

## Verification

`cargo test --manifest-path native/unictl_native/Cargo.toml`: 7 unit tests on `format_liveness_response` (A6) pass green. `cargo build`: green. Live integration testing requires an editor session and is part of A6 / Phase B sandbox tests.

## Next phases

- A5: schema versioning policy doc (cross-references this doc's HTTP-vs-envelope split).
- A6: integration tests covering the reload boundary on a sandbox editor.
- A7: ABI freeze gate signoff.
