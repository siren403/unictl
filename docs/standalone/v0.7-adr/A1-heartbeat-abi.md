<!-- A1 — Heartbeat ABI sign-off ADR (2026-05-06) -->
<!-- Source: siren403/unictl#7 Phase A1 -->

# A1 — Heartbeat ABI Sign-off (ADR)

## Status

Accepted — gates A2 (managed emitter), A3 (Rust receiver + `/liveness` route), A7 (ABI freeze).

## Scope

Defines the binding contract for the heartbeat ABI introduced in unictl v0.7. Consumes the F.8 (ABI policy) and F.9 (pipe/socket reload parity) outputs and translates them into prescriptive rules for downstream Phase A tasks.

This ADR is the single normative reference for A2/A3 implementation. Any deviation requires a new ADR or amendment merged before the deviating PR lands.

## Contract: native exports added in v0.7

### `unictl_heartbeat`

```c
int32_t unictl_heartbeat(int64_t timestamp_ms, const char* state_json);
```

- Calling convention: cdecl (matches all existing exports in `lib.rs`).
- Caller: managed C# (`UnictlHeartbeat.cs`, A2).
- Frequency: 1Hz from `EditorApplication.update` (throttled) plus an immediate emit on every phase transition.
- `state_json`: null-terminated UTF-8 JSON. Per F.8: JSON-over-pipe only. No `repr(C)` struct crosses the boundary.
- `timestamp_ms`: managed-side monotonic timestamp from `Stopwatch.GetTimestamp()` divided to ms (per R16, never wall clock). Native ignores this in v0.7 and captures `std::time::Instant::now()` at receipt instead — also monotonic. The ms value is shipped for forensic logging and for managed-side staleness checks during a reconnect.
- Return: `0` on success. Non-zero values are reserved for A3 (e.g. `-1` parse failure, `-2` shutdown). A2 stub returns `-1` only when `state_json` is null.
- Side effect: native stores the latest payload in `static LIVENESS` plus updates `last_managed_instant`.

### `unictl_get_liveness`

```c
int32_t unictl_get_liveness(uint8_t* buf, uintptr_t len);
```

- Caller: anyone needing a current-state snapshot (CLI via `/liveness` route, smoke tests, future tooling).
- Returns bytes written, or `-1` if `buf` too small.
- A2 leaves this unimplemented — included in this contract so A3 lands the receiver as a single PR.

## State JSON schema (v1)

```json
{
  "schema_version": 1,
  "phase": "idle|compiling|reloading|playing|paused|importing|quitting",
  "is_playing": false,
  "is_compiling": false,
  "is_paused": false,
  "session_id": "<guid from UnictlServer.SessionId>",
  "unity_version": "6000.0.32f1",
  "platform": "WindowsEditor"
}
```

- `schema_version`: integer. Additive field changes do **not** bump this. Required-field additions, deprecations, or semantic changes do (per Cross-phase concerns).
- `phase`: derived enum (precedence below).
- `is_*`: redundant booleans for fine-grained reads. Native does not interpret these in v0.7.
- `session_id`, `unity_version`, `platform`: reuse `UnictlServer.SessionId`, `Application.unityVersion`, `Application.platform.ToString()`.

## Phase enum (precedence ordering)

```
quitting > reloading > compiling > importing > playing > paused > idle
```

Order was set by F.7/F.9 analysis. Highest-precedence true state wins. Importing is reserved for A3+ (requires `EditorApplication.isUpdating` tracking which is a separate signal); A2 ships idle/compiling/reloading/playing/paused/quitting only.

Managed pushes `phase: "reloading"` from inside `OnBeforeReload`. Per F.9 analysis, this is informational — the native pipe handle persists across reload regardless. The reload phase value lets `/liveness` readers display "reloading, since X ms" instead of guessing from heartbeat staleness alone.

## Reload window contract (from F.9)

- `/liveness` is the only route guaranteed during the reload window.
- Route lives in `protocol.rs`, reads from `static LIVENESS`, never calls into managed.
- During reload (`HANDLER == None`): returns 200 with current cached state plus `since_ms` derived from `Instant::elapsed()`.
- After 30 s without heartbeat: state flips to `unresponsive` (still 200, observable). Threshold overridable via `UNICTL_RELOAD_THRESHOLD_MS`.
- All other routes during reload: 503 with `{ok:false, code, kind:"editor_reload_active"}`.

## Implementation prerequisites for A2

- Use `Stopwatch.GetTimestamp()` (monotonic) for `timestamp_ms` — not `DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()`. R16.
- Subscribe to: `CompilationPipeline.compilationStarted/Finished`, `AssemblyReloadEvents.beforeAssemblyReload`, `EditorApplication.playModeStateChanged`, `EditorApplication.update` (1Hz throttled), `EditorApplication.quitting`.
- Cache the serialized JSON string between phase changes — emit reuses the cached UTF-8 string for the steady-state 1Hz tick. Goal: <4KB/s allocation (F.1 budget).
- Use `[MarshalAs(UnmanagedType.LPUTF8Str)]` on the P/Invoke `state_json` parameter. Default `LPStr` is ANSI on Windows and would corrupt non-ASCII unity_version values.
- Do not block in `EditorApplication.update`. The heartbeat call is synchronous P/Invoke into Rust which writes into a `Mutex<Option<String>>` then returns — F.3 microbenchmark expects p99 < 200 µs.
- F.1 perf measurement scaffolding ships in A2 behind a `UNICTL_HEARTBEAT_PERF` scripting symbol (off by default).

## Implementation prerequisites for A3

- `static LIVENESS` upgraded from `Mutex<Option<String>>` to a typed struct: parsed JSON cache, `AtomicI64 last_heartbeat_ms`, `Mutex<Instant> last_managed_instant`, `AtomicI32 pid` (filled by `unictl_start` not `unictl_heartbeat`).
- New route handler in `protocol.rs`: `("GET", "/liveness")` reads `LIVENESS`, computes `since_ms = last_managed_instant.elapsed().as_millis()`, returns 200 JSON.
- Reload semantics gate: when `since_ms > UNICTL_RELOAD_THRESHOLD_MS` (default 30000), override `phase` to `unresponsive` in the response.
- Use `std::time::Instant` (monotonic) for staleness math. Never `SystemTime`.

## Additive-only ABI contract (per A7 / F.8)

- Existing exports immutable for v0.7. Any change to an existing export's signature is forbidden until v0.8.
- New exports may be added; each addition bumps `native_version` minor.
- v0.7 consumers must accept unknown JSON fields and unknown DLL exports without erroring.

## Error code allocation

Heartbeat-domain codes draw from the `ipc_*` namespace (per F.6 stride 0x1000). Initial allocation:

| Code | Kind | Meaning |
|------|------|---------|
| 0x5010 | `heartbeat_invalid_payload` | A2/A3: `state_json` null or unparseable |
| 0x5011 | `heartbeat_native_unavailable` | Managed: P/Invoke call failed (DLL missing or unloaded) |
| 0x5012 | `liveness_buffer_too_small` | A3: `unictl_get_liveness` return -1 with required size |

C9 will allocate these formally in `code-allocations.json`.

## Open items deferred

- F.1 actual perf measurement: A2 ships scaffolding; live numbers attach to the A2 review thread once an editor session is available.
- macOS pipe parity verification (F.9 deferred to next macOS session).
- `Importing` phase tracking — A3 or later phase, requires `EditorApplication.isUpdating` integration.
- `UNICTL_RELOAD_THRESHOLD_MS` env override wiring — A3 (lives in Rust receiver, not managed).

## Sign-off

This ADR satisfies the Phase A entry criterion in `docs/standalone/v0.7-spikes/README.md` ("F.8 ADR merged" + "F.9 Windows analysis complete" — consolidated here). A2/A3 implementation may proceed.
