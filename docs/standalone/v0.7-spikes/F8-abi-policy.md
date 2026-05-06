# F.8 -- ABI Struct Layout Policy (ADR)

## Status

Accepted (Phase 0, gates Phase A).

## Context

unictl v0.7 introduces a per-frame heartbeat path (Phase A) plus an optional
push-style phase channel (Phase D, per F.7) flowing between the Unity-side
managed emitter and the Rust native bridge. Both directions need an agreed
on-the-wire shape before A1 can sign off and before A2 / A3 can be implemented
in parallel.

The existing native surface (`tools/unictl/native/unictl_native/src/lib.rs`)
already establishes a clear pattern. The exports `unictl_ping`,
`unictl_counter`, `unictl_set_internal_port`, `unictl_start`,
`unictl_register_handler`, `unictl_unregister_handler`, `unictl_pop_main`,
`unictl_free_string`, and `unictl_respond` cross the boundary using only
primitives (`i32`, `*const c_char`, `*mut c_char`) plus JSON strings. No
`repr(C)` aggregate is shared today. The static state held in `COUNTER`,
`HANDLER`, `MAIN_QUEUE`, `ASYNC_RESPONSES`, and `INTERNAL_PORT` survives
Unity's Mono AppDomain reload precisely because the DLL memory persists while
managed types are torn down and rebuilt; introducing managed/native struct
identity at this boundary would create a second consistency surface that has
to survive that same teardown.

Phase A adds two new exports at the same boundary: `unictl_heartbeat(timestamp_ms: i64, state_json: *const c_char)` and `unictl_get_liveness(buf: *mut c_char, len: i32)`.
Phase D may later add `unictl_native_subscribe_phase`. Locking the layout
policy now -- before A2/A3 implementation begins -- prevents a divergent
shared-struct path from being introduced opportunistically during Phase A.

## Decision

unictl v0.7 ABI is JSON-over-pipe only. No `repr(C)` structs cross the
Rust<->C# boundary.

## Constraints implied

- All structured payloads are JSON-encoded UTF-8 strings, transferred via the
  existing `*const c_char` / `*mut c_char` mechanism plus `unictl_free_string`
  ownership rules.
- Native exports may take and return only primitives (`i32`, `i64`,
  `*const c_char`, `*mut c_char`) and JSON-encoded strings. Managed-side
  P/Invoke signatures mirror this set.
- Adding fields to JSON payloads is non-breaking and does not bump
  `schema_version` (additive-only contract carried over from A7 and from the
  uniform schema-versioning policy in the v0.7 plan). Consumers on both sides
  must accept unknown fields.
- Adding required fields, deprecating fields, or changing semantics requires a
  `native_version` minor bump on the export side and a `schema_version` major
  bump on the payload side, per A7.
- Allocator ownership rules already encoded in `lib.rs` (CoTaskMem on Windows,
  libc free on macOS for managed-allocated returns; `CString::into_raw` paired
  with `unictl_free_string` for native-allocated returns) extend unchanged to
  every new JSON-bearing export.

## Consequences

### Positive

- Mono runtime upgrades and platform-specific struct padding cannot silently
  break the protocol. JSON is layout-immune.
- Schema evolution is additive without ABI breakage. Phase A can ship and
  Phase D can extend the same channel later without touching A2/A3 binary
  compatibility.
- Cross-platform consistency: Windows (`stdcall`-adjacent calling conventions,
  CoTaskMem allocator) and macOS (System V AMD64 + libc allocator) expose
  identical primitive-only signatures, removing one variable from the
  `cfg(target_os = "...")` matrix.
- Debuggability: any payload can be inspected by `jq`, copied into a CLI log,
  or asserted in a smoke test without a custom struct decoder. Bug reports
  attach plain text rather than hex dumps.
- Existing surface stays uniform: A1 / A2 / A3 / D8 inherit the same
  ownership and free-rules already validated by `unictl_pop_main` and
  `unictl_respond`.

### Negative / costs

- Performance: JSON serialize on the managed side and `serde_json::from_str`
  on the Rust side add per-call latency. F.1 measures this against the
  heartbeat budget (target: under 200us p99 emit+parse) and is the formal
  gate; if F.1 fails, the fallback is the pre-allocated buffer mitigation in
  R1/R3, not abandoning JSON.
- Type safety: JSON is dynamically typed. Both sides can drift unless the
  shape is documented and validated. Mitigated by the schema doc folded into
  the A1 ADR and by `serde_json` strict-typed structs on the Rust side that
  reject malformed payloads.
- Bandwidth: JSON is verbose vs. a packed C struct. Heartbeat payloads are
  under 512 bytes typical (`tick`, `last_heartbeat_ms`, `state`, `scene`,
  `schema_version`), well within the per-frame budget. Phase D phase events
  remain in the same envelope size class.
- Allocations: each call allocates at least one managed string and one
  `CString`. R1 / R3 already track this risk; the pre-allocated buffer
  fallback is reserved for it.

## Alternatives considered

1. **`repr(C)` shared structs.** Rejected. Mono runtime upgrades can shift
   field padding without warning, and changing a shared struct's layout is a
   silent ABI break that surfaces only as misread fields at runtime. Schema
   evolution would require versioned struct copies on both sides for every
   additive change, which the additive-only JSON contract handles for free.
   Cross-platform calling-convention and alignment differences add a
   maintenance tax that the current primitives-only surface avoids entirely.

2. **FlatBuffers / Cap'n Proto.** Rejected for v0.7. Both deliver schema
   evolution and zero-copy decode, but they introduce a code-generation step
   and a runtime dependency on each side, expanding the build matrix and the
   audit surface (`mise run check` would need to validate generator output
   parity between C# and Rust). The heartbeat path's payload is small and
   per-frame, not bulk binary. The cost outweighs the marginal latency win,
   especially while F.1 has not yet shown JSON misses budget.

3. **Mixed (primitives via struct, payload via JSON).** Rejected. A struct
   wrapping `i64 timestamp_ms` plus a `*const c_char state_json` saves no
   bytes versus passing both as direct parameters and adds the very layout-
   compatibility surface the decision is trying to remove. The current
   `unictl_heartbeat(timestamp_ms: i64, state_json: *const c_char)` signature
   is strictly simpler and equivalent in expressiveness.

## Reconsideration triggers (when v0.8+ might revisit)

- F.1 measurements -- or post-Phase A telemetry from real consumers -- show
  JSON serialize/parse exceeding the heartbeat budget under realistic load,
  and the pre-allocated buffer fallback in R1/R3 is insufficient.
- A new use case requires zero-copy access to a native-owned data structure
  (for example, a shared frame buffer, a large debug-snapshot blob, or a
  streaming binary asset channel) where copying through JSON is provably
  wasteful.
- A consumer needs strongly typed schema enforcement at compile time strong
  enough that the documentation-plus-validator approach is no longer
  defensible.

Any such revisit is a v0.8+ ADR; v0.7 does not change.

## Implementation note for Phase A

- A2 (managed emitter) marshals the heartbeat state to a UTF-8 JSON string via
  `Marshal.StringToHGlobalAnsi` (or `StringToCoTaskMemUTF8`, matching the
  allocator already used in `call_handler`) and passes it as the `state_json`
  argument to `unictl_heartbeat`. Allocations follow the same free-rules as
  existing async paths in `lib.rs`.
- A3 (Rust receiver) reads `state_json` with `CStr::from_ptr` and parses with
  `serde_json::from_str` into a strict typed struct. Unknown fields are
  ignored (`#[serde(default)]` on the receiver) so additive schema changes
  remain non-breaking. `unictl_get_liveness` returns the current liveness
  record as JSON written into the caller-provided buffer; the caller owns the
  buffer.
- A1 ADR sign-off cites this document as the source of the JSON-only
  decision; A7 freeze gate inherits the additive-only contract from this
  policy and from the v0.7 plan's uniform schema-versioning rule.
