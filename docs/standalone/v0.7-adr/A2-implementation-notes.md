<!-- A2 — Managed heartbeat emitter implementation notes (2026-05-06) -->

# A2 — Implementation Notes

Phase A2 lands the managed-side heartbeat emitter (`UnictlHeartbeat.cs`) plus the Rust stub export (`unictl_heartbeat`) so the wire shape can be exercised end-to-end without committing the receiver's struct layout. A3 will replace the stub with a typed `LIVENESS` struct and add the `/liveness` route.

## Files added or changed

| Path | Change |
|------|--------|
| `tools/unictl/native/unictl_native/src/lib.rs` | +`static LIVENESS: Mutex<Option<String>>`; +`pub extern "C" fn unictl_heartbeat(timestamp_ms, state_json) -> i32` |
| `tools/unictl/packages/upm/com.unictl.editor/Editor/Unictl/Internal/UnictlNative.cs` | +P/Invoke binding for `unictl_heartbeat` with `[MarshalAs(UnmanagedType.LPUTF8Str)]` |
| `tools/unictl/packages/upm/com.unictl.editor/Editor/Unictl/Internal/UnictlHeartbeat.cs` | new — `[InitializeOnLoad]` static class implementing the emitter |
| `tools/unictl/docs/standalone/v0.7-adr/A1-heartbeat-abi.md` | new — A1 ADR |
| `tools/unictl/docs/standalone/v0.7-adr/A2-implementation-notes.md` | new — this document |

`cargo check --manifest-path tools/unictl/native/unictl_native/Cargo.toml` was run after the Rust changes and exited 0 (only checked the existing target dir; no clippy run).

C# compilation cannot be verified without Unity. Syntax was reviewed against `UnictlServer.cs` style; `using` directives, namespace, and access modifiers match the convention used by neighbouring files in `Internal/`. Unity will create the `.meta` file on next editor open per the `.meta` rules in `AGENTS.md`.

## Phase transition matrix

| Trigger | Effect on phase |
|---------|-----------------|
| `EditorApplication.update` (1 Hz throttled) | re-derive phase, emit if changed or cache empty |
| `CompilationPipeline.compilationStarted` | derive → `Compiling`, force emit |
| `CompilationPipeline.compilationFinished` | derive → next phase, force emit |
| `AssemblyReloadEvents.beforeAssemblyReload` | flag `s_reloading=true` → `Reloading`, force emit |
| `EditorApplication.playModeStateChanged` | derive → `Playing`/`Paused`/`Idle` per state, force emit |
| `EditorApplication.quitting` | flag `s_quitting=true` → `Quitting`, force emit |

`Importing` is reserved for A3+; tracking `EditorApplication.isUpdating` adds enough complexity to warrant a separate task.

Phase precedence (highest first), per A1 ADR:

```
Quitting > Reloading > Compiling > Playing > Paused > Idle
```

`Phase.Importing` exists in the JSON enum but is not currently emitted by A2.

## JSON cache invalidation

`s_cachedJson` is invalidated only on phase transition (`s_phase` changes). The 1 Hz steady-state tick reuses the cached UTF-8 string so no allocation occurs on the hot path beyond the P/Invoke marshaling.

The cache holds the full state snapshot, including booleans (`is_playing`, `is_compiling`, `is_paused`). Booleans are derived from the same source as the phase, so when the phase changes they are correct as of the same moment. There is no boolean-without-phase-change scenario in v0.7.

## Subscription order vs UnictlServer

Both `UnictlHeartbeat` and `UnictlServer` are `[InitializeOnLoad]` static classes. Unity runs static initializers in alphabetical class-name order within an assembly: `UnictlHeartbeat` before `UnictlServer`. Subscription order therefore matches: `UnictlHeartbeat`'s `beforeAssemblyReload` handler fires first, lands the final `phase: "reloading"` payload, then `UnictlServer.OnBeforeReload` calls `unictl_unregister_handler`.

Order is not a correctness requirement — `unictl_heartbeat` writes directly into Rust static memory and does not depend on the managed handler being registered. The order does help observability: a `/liveness` query during the reload window sees `phase: "reloading"` immediately rather than the previous phase.

## Perf measurement scaffolding (F.1 deferred)

Define `UNICTL_HEARTBEAT_PERF` in Project Settings → Player → Scripting Define Symbols (Editor platform) to enable the measurement block in `UnictlHeartbeat.cs`. Behavior:

- Wraps each `unictl_heartbeat` call with `Stopwatch.GetTimestamp()` and `GC.GetAllocatedBytesForCurrentThread()`.
- Maintains a rolling window of the last 60 samples.
- Every 60 s emits one `Debug.Log` line:
  ```
  [unictl][perf] heartbeat samples=60 p50=45us p99=180us alloc=2400B/s window=60.0s
  ```

### F.1 measurement plan for the A2 review

1. Open the `sandbox/UnictlSmokeProject` (or any consumer with the package installed).
2. Add `UNICTL_HEARTBEAT_PERF` to scripting symbols. Recompile.
3. Leave the editor idle for 5 minutes. Capture the `[unictl][perf]` log lines.
4. Trigger a few phase transitions (enter/exit play mode, force a compile via touching a script). Capture more samples.
5. Attach the captured numbers to the A2 PR review thread.

### F.1 budget (from plan)

- p99 emit latency < 200 µs
- Allocation rate < 4 KB/s steady-state

Allocation budget assumes the cached JSON path is used. Any phase change rebuilds the JSON via a `StringBuilder` (one allocation, ~256 bytes capacity, returned once as a `String`). At a typical session phase-change rate (~1/min during active development) this is negligible.

If either AC fails:
- Latency: investigate P/Invoke marshaling of the UTF-8 string. `LPUTF8Str` should avoid intermediate copies; if not, switch to a pre-allocated `byte[]` and pass by `IntPtr`.
- Alloc: profile to find the hot allocator. Most likely culprits are `Application.unityVersion` (returns the same string every call but Unity may not intern it), or boxing of `Phase` in switch statements (none currently).

## Known limitations / deferred work

- A3 will replace `Mutex<Option<String>>` with a typed struct and add the `/liveness` route. Until A3 lands, `unictl_heartbeat` accepts payloads but no consumer reads them.
- `unictl_get_liveness` export is declared in the A1 ADR but unimplemented in v0.7 source. A3 adds it.
- `UNICTL_RELOAD_THRESHOLD_MS` env override is an A3 concern (lives in the receiver, not the emitter).
- Importing phase: not tracked. A3 or later.
- macOS pipe parity (F.9 TBD) does not block A2 — same managed code emits on both platforms; native handles `state_json` UTF-8 decoding identically.
- `mise run check` was not run from this work session because Unity is not available in the agent environment to verify C# compilation. The Rust portion (`cargo check`) is green. C# compilation will be exercised on the next editor open.

## Next phase

A3 — Rust receiver + `/liveness` route. Reads from `static LIVENESS`, exposes the route in `protocol.rs`, applies the reload-window contract from A1 ADR.
