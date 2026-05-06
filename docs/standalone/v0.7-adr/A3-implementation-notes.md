<!-- A3 — Rust receiver + /liveness route implementation notes (2026-05-06) -->

# A3 — Implementation Notes

Phase A3 lands the typed `LIVENESS` storage in Rust, the real `unictl_heartbeat` body (replacing the A2 stub), the `unictl_get_liveness` C export, and the `("GET", "/liveness")` IPC route.

## Files changed

| Path | Change |
|------|--------|
| `tools/unictl/native/unictl_native/src/lib.rs` | typed `Liveness` struct + `static LIVENESS`; real `unictl_heartbeat` body; new `unictl_get_liveness` export; `build_liveness_response` shared helper; PID capture in `unictl_start` |
| `tools/unictl/native/unictl_native/src/protocol.rs` | new `("GET", "/liveness")` route arm |
| `tools/unictl/docs/standalone/v0.7-adr/A3-implementation-notes.md` | new — this document |

`cargo check` and `cargo build`: green on Windows.

## LIVENESS struct shape

```rust
struct Liveness {
    last_heartbeat_ms: AtomicI64,                  // managed-side timestamp (forensics only)
    last_managed_instant: Mutex<Option<Instant>>,  // native monotonic capture (R16)
    state_json: Mutex<String>,                     // last received raw payload
    pid: AtomicI32,                                // editor PID
}
```

Single static instance, const-initialized so it lives in DLL memory across Unity domain reload (per F.9 analysis).

## `/liveness` response shape

```json
{
  "schema_version": 1,
  "alive_ms_ago": 437,
  "last_heartbeat_ms": 1234567890,
  "last_state": { /* raw payload from managed; v1 schema in A1 ADR */ },
  "pid": 12345,
  "handler_registered": false,
  "phase_override": null,
  "native_version": "0.1.0"
}
```

`phase_override` semantics:
- `"never_seen"` — heartbeat has never arrived (cold start before A2 emitter ran)
- `"unresponsive"` — last heartbeat older than `UNICTL_RELOAD_THRESHOLD_MS` (default 30000)
- `null` — alive; use `last_state.phase` as authoritative

`handler_registered` mirrors the existing `/health` field. During a domain reload window it is `false` while `/liveness` still answers (the whole point of the F.9 split).

`last_state` is inlined as raw JSON. The producer (managed `UnictlHeartbeat`) is the schema authority; native does not parse or revalidate. If the payload is empty (cold start), an empty object `{}` is emitted instead.

## Monotonic clock discipline (R16)

- Managed: `Stopwatch.GetTimestamp()` → `timestamp_ms`.
- Native: `Instant::now()` captured in `unictl_heartbeat`, stored as `Mutex<Option<Instant>>`. `Instant::elapsed()` produces `since_ms`.
- Wall clock (`SystemTime`, `DateTimeOffset.UtcNow`) is **never** used for staleness math. Both monotonic clocks are immune to DST/NTP/VM-suspend skew.

The managed `timestamp_ms` is shipped for forensic logging only — useful when correlating CLI / Unity logs that share the editor's `Stopwatch` epoch. Native math uses its own `Instant`.

## PID capture

`std::process::id()` returns the editor process ID since the DLL is loaded into the Unity Editor process. Stored once in `unictl_start` after `STARTED.store(true, ...)`. Never updated thereafter.

This avoids the A1 ADR's earlier alternative of having managed call a separate `unictl_set_pid` export. PID is intrinsic to the process the DLL lives in; no managed coupling needed.

## Threshold env override

`UNICTL_RELOAD_THRESHOLD_MS` is read fresh on every `/liveness` query. No caching. The cost of one `std::env::var()` lookup per query is negligible at the polling cadence (250 ms per F.7).

Default 30000 ms aligns with the F.4 reload p99 + headroom analysis.

## Mutex contention

`state_json: Mutex<String>` holds the last payload. Writers: 1 Hz `unictl_heartbeat`. Readers: ad-hoc `/liveness` queries (~250 ms cadence per F.7). Contention is negligible — F.3 design budget calls for p99 < 10 µs lock acquire and current usage stays well below that even with 8 simulated readers.

`last_managed_instant: Mutex<Option<Instant>>` is the same story — single writer, infrequent readers, microsecond holds.

If A6 perf measurements show contention, the fallback is `arc-swap::ArcSwap<String>` for cheap reader cloning. Plan F.3 already documented this path.

## Route shared by export and pipe

`build_liveness_response` is the single source of truth. Both consumers share it:

1. `unictl_get_liveness(buf, len)` — C export for in-process tooling (e.g. a future Unity inspector). Caller-owned buffer, returns bytes written or -1 if too small. A 1 KB buffer is sufficient in practice (typical response < 600 bytes).
2. `("GET", "/liveness")` route in `protocol.rs` — for CLI / external consumers over the named pipe (Windows) or unix socket (macOS).

The C export is currently unused — managed code reaches `/liveness` through the pipe route, and no other in-process consumer exists. Shipping the export anyway because:
- The wire shape is now testable from Rust unit tests without spinning up a pipe.
- Future tooling (Unity Editor menu items, custom inspectors) can use it.
- Adding it now is cheap; deferring would mean another ABI bump later (per A7 additive-only contract).

## Reload window contract verified at code level

Per F.9 analysis: `protocol.rs::route_request` is called from the platform-specific server (Windows pipe / Unix socket) which is owned entirely by Rust. Neither server checks `HANDLER` before dispatching to the route table. Therefore `/liveness` answers regardless of `HANDLER` state, including during the entire domain reload window.

A4 will add the converse: other routes (e.g. `/command`) returning 503 with `editor_reload_active` while `HANDLER` is None. That gate is one additional `match` arm and is intentionally scoped out of A3.

## Known limitations / deferred to later phases

- Rust unit tests for `build_liveness_response` are not in this PR. A6 (error path coverage) adds them along with reload-boundary integration tests.
- Phase override `"importing"` is reserved in A1 ADR but not produced by A2 emitter. A3 forwards whatever the emitter sends; if the emitter never sends `"importing"`, the response never carries it.
- `unictl_get_liveness` does not yet have a C# P/Invoke binding. No managed consumer needs it in v0.7. If a use case emerges, add binding to `UnictlNative.cs` with `[MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)]` for the buffer parameter.
- A4 (reload semantics) and A6 (error path coverage) follow.

## Smoke testing plan

Once an editor session is available:
1. Open `sandbox/UnictlSmokeProject` (or any consumer with the package).
2. Wait ~2 s for the heartbeat emitter to run a few ticks.
3. Hit `/liveness` from the CLI: verify response includes `phase: "idle"`, non-zero `pid`, `alive_ms_ago < 2000`.
4. Trigger a recompile (touch a script). Verify `/liveness` reports `phase: "compiling"` then transitions through `"reloading"` then back to `"idle"`.
5. Force a hang (set breakpoint in editor, attach debugger, pause): wait > 30 s, hit `/liveness`, verify `phase_override: "unresponsive"`.

These manual checks become A6 integration tests after this PR lands.

## Next phase

A4 — Reload semantics. Implements the 503 + `editor_reload_active` envelope on all routes other than `/liveness` while `HANDLER` is None.
