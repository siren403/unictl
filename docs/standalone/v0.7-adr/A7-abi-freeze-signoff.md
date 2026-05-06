<!-- A7 — ABI freeze gate signoff (2026-05-06) -->

# A7 — ABI Freeze Gate (Signoff)

Phase A7 closes Phase A by recording the final list of native exports shipped in v0.7 and the additive-only contract that governs all further ABI evolution.

## Status

**Accepted.** The exports enumerated below are frozen as the v0.7 ABI surface. Further phases (B-F) may add new exports following the additive-only contract; existing exports cannot change shape until v0.8.

## v0.7 native ABI surface

`tools/unictl/native/unictl_native/src/lib.rs` exposes the following exports as of Phase A close (post-A4 / A6):

| Export | Signature | Phase | Purpose |
|--------|-----------|-------|---------|
| `unictl_ping` | `() -> i32` | v0.6 | Liveness probe — returns 42 |
| `unictl_counter` | `() -> i32` | v0.6 | Monotonic call counter — used by managed for sync sanity |
| `unictl_set_internal_port` | `(i32)` | v0.6 | Register C# HttpListener port for main-loop wake |
| `unictl_start` | `(*const c_char) -> i32` | v0.6 (A3 captures PID) | Start native server on given pipe / socket path |
| `unictl_register_handler` | `(CommandHandler)` | v0.6 | Register C# command callback |
| `unictl_unregister_handler` | `()` | v0.6 | Unregister callback (called from `OnBeforeReload`) |
| `unictl_pop_main` | `() -> *mut c_char` | v0.6 | Managed pulls next item from MAIN_QUEUE |
| `unictl_free_string` | `(*mut c_char)` | v0.6 | Free C string allocated by `unictl_pop_main` |
| `unictl_respond` | `(*const c_char, *const c_char)` | v0.6 | Async response from managed back to native |
| **`unictl_heartbeat`** | `(i64, *const c_char) -> i32` | **v0.7 / A2** | Receive heartbeat from managed (JSON-over-pipe per F.8) |
| **`unictl_get_liveness`** | `(*mut u8, usize) -> i32` | **v0.7 / A3** | Read current liveness JSON into caller-owned buffer |

Two new exports added in v0.7. Both follow F.8's JSON-over-pipe rule — no `repr(C)` shared structs cross the boundary.

## Additive-only contract (post-A7)

After the v0.7.0 release tag is cut:

- **No existing export may change** in name, signature, calling convention, or contract until v0.8.
- **New exports may be added** — each addition bumps `native_version` minor (e.g. v0.7.0 → v0.7.1 ABI).
- **Consumers must accept unknown exports** in the DLL without erroring. The Mono / .NET DllImport mechanism naturally satisfies this — managed code only resolves the exports it imports.
- **Consumers must accept unknown JSON fields** in payloads (per A5 schema versioning).

## Forward-compatibility fixture

To prove the contract holds at code level, the following invariants are enforced:

1. `unictl_native v0.1.x` source file `lib.rs` defines all 11 exports above with `#[unsafe(no_mangle)] pub extern "C"`.
2. C# `UnictlNative.cs` references existing exports by name; new exports added in v0.7 (`unictl_heartbeat`) are bound with `[DllImport]`.
3. Managed code does not bind `unictl_get_liveness` because no managed consumer needs it in v0.7. This is the correct test of "consumer accepts unknown exports": the managed side ignores `unictl_get_liveness` entirely without breakage.

A future v0.8 PR adding (for example) `unictl_native_subscribe_phase` (per F.7 reconsideration triggers) follows the same pattern — added export, no shape change to existing ones, managed consumers add bindings only when they need them.

## Schema impact

Per A5 schema versioning policy, payload changes evolve independently from ABI changes:

- Heartbeat payload (`unictl_heartbeat` `state_json`): managed `UnictlHeartbeat.cs` is the producer; bumps `schema_version` per A5 rules.
- `/liveness` response: native `build_liveness_response` is the producer; bumps `schema_version` per A5 rules.
- Both schemas can evolve without bumping `native_version` and vice versa.

## Verification at release time

`mise run check` (or future `check:abi`) should enumerate the exports in `lib.rs`, compare against this signoff list, and fail on:
- Missing exports (regression).
- Renamed exports (breaking change).
- Signature changes to existing exports (breaking change).
- Net new exports without a `native_version` bump in `Cargo.toml`.

Adding the check as automation is deferred to Phase F (release validation). For v0.7.0 the check is manual: reviewer compares the export list in `lib.rs` against this document at release prep.

## Sign-off

Phase A entry criteria from `v0.7-spikes/README.md` are now exit criteria for Phase A:

- [x] F.8 ADR merged (ABI policy locked) — `F8-abi-policy.md`
- [x] F.9 Windows analysis complete — `F9-pipe-parity.md`
- [x] A1 ADR consolidating F.8 + F.9 — `A1-heartbeat-abi.md`
- [x] A2 managed emitter shipped — `A2-implementation-notes.md`, `UnictlHeartbeat.cs`
- [x] A3 Rust receiver + `/liveness` route — `A3-implementation-notes.md`, `lib.rs`, `protocol.rs`
- [x] A4 reload semantics — `A4-reload-semantics.md`, `lib.rs::handle_command`
- [x] A5 schema versioning policy — `A5-schema-versioning.md`
- [x] A6 unit tests for liveness formatter — `lib.rs::tests` module (7 tests, green)
- [x] A7 ABI freeze signoff — this document

**Phase A closed.** Phase B (PID liveness via `runtime.json`) is unblocked.
