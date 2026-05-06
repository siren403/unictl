<!-- v0.7 Phase 0 spike closure — 2026-05-06 -->

# Phase 0 Spike Closure

unictl v0.7 (issue #7) Phase 0 spike outcomes. Each spike either gates a downstream phase or produces a deliverable consumed by an implementation task.

## Status matrix

| Spike | Status | Outcome | Gates / Consumed by |
|-------|--------|---------|---------------------|
| F.1 — Heartbeat perf budget | Deferred | Folded into A2; F.4 provides regression anchors | A2 PR must attach perf-reviewer measurement |
| F.2 — PID file lock | ✅ Decided | **lockfile-on-rename** (matches existing TestProgressFile/BuildRunner pattern) | B1, B2 |
| F.3 — `--wait` timeouts | ✅ Decided | Per-verb×state matrix + `UNICTL_WAIT_TIMEOUT_DEFAULT_*` env override | D4 |
| F.4 — Transport throughput baseline | ✅ Decided | criterion sketch + zero-dep harness; D8 regression rule: p99 +50% | D8 |
| F.5 — v0.6 surface compat | ✅ Decided | 20 entries (8 unchanged + 12 wrap-warn, 0 hard-error/rename) | C8 |
| F.6 — Error namespaces | ✅ Decided | 46 kinds verified, stride 0x1000/domain, 16-bit codes, all unique | C5, C9 |
| F.7 — Push vs Poll | ✅ Decided | **Pull (Option A)** — 250ms cadence, no new native export | D3, D4 |
| F.8 — ABI struct policy | ✅ Decided | **JSON-over-pipe only** — no repr(C) shared structs in v0.7 | A1, A2, A3, A7 |
| F.9 — Pipe/socket reload parity | ✅ Decided (Windows) | `/liveness` Rust-only servable on both; pipe handle persists across reload | A4 |

Open verification items deferred:
- F.9 macOS verification — next macOS session or CI matrix.
- F.1 actual measurement — A2 PR.
- F.4 live numbers — fill `F4-baseline-numbers.txt` once editor + A2 stub exists.

## Decisions binding Phase A

1. **JSON-over-pipe only** (F.8). All A2/A3 payloads are JSON; no `repr(C)` exports.
2. **`/liveness` Rust-only** (F.9). Route lives in `protocol.rs` and answers from `static LIVENESS` populated by managed heartbeat before unregister. No managed call required during reload window.
3. **Monotonic clocks** (per R16). Managed: `Stopwatch.GetTimestamp()`. Rust: `std::time::Instant`.
4. **Pull-based `--wait`** (F.7). No `unictl_native_subscribe_phase` export. Phase D D3/D4 implement bounded `/liveness` polling at 250ms.
5. **Additive-only ABI post-A7**. Existing exports immutable; new exports bump `native_version` minor.

## Decisions binding Phase B

1. **lockfile-on-rename** for `runtime.json` (F.2). Matches existing `TestProgressFile.cs` / `BuildRunner.cs` write-tmp-then-`File.Move` pattern.
2. **`terminal_reason` field** in schema (per critic 1.3, plan B1). Distinguishes `quit` vs `crash` vs `unknown`.

## Decisions binding Phase C

1. **`--describe` is canonical**. `--help --json` becomes deprecated alias in v0.7, removed in v1.0 (per critic 4.0).
2. **`--json` default ON** on new verb-noun tree, `UNICTL_HUMAN=1` overrides (per critic 1.5).
3. **Error namespaces stride 0x1000** with 46 kinds initial allocation (F.6). `code-allocations.json` is the authoritative mapping; `check:error-registry` enforces uniqueness.
4. **C8 compat shims** consume `F5-compat-map.json` directly. 12 wrap-warn entries, 0 rename / hard-error.

## Decisions binding Phase D

1. **`--wait` poll cadence**: 250ms default, `UNICTL_WAIT_POLL_INTERVAL_MS` override clamped [50, 5000] (F.7).
2. **Per-verb×state default timeouts** from F.3 matrix.
3. **D8 regression threshold**: p99 +50% relative to F.4 baseline blocks PR.
4. **SIGINT cancellation** during `--wait` returns exit 130 with `kind:"interrupted"`.

## Files in this directory

- `F2-pid-lock.md` — PID file locking strategy decision
- `F3-wait-timeouts.md` — `--wait` timeout matrix and override mechanism
- `F4-transport-baseline.md` — transport throughput baseline + benchmark sketches
- `F5-compat-map.json` / `F5-compat-map.md` — v0.6→v0.7 compat catalog
- `F6-error-namespaces.md` — error code namespace allocation + 46-kind mapping
- `F7-push-vs-poll.md` — `--wait` push-vs-poll ADR (Pull chosen)
- `F8-abi-policy.md` — Rust↔C# ABI struct policy ADR (JSON-over-pipe only)
- `F9-pipe-parity.md` — Windows pipe vs Unix socket reload parity analysis
- `README.md` — this closure document

## Phase 0 → Phase A entry criteria

All gates met for Phase A entry:
- [x] F.8 ADR merged (ABI policy locked)
- [x] F.9 Windows analysis complete (`/liveness` route can be served Rust-only)
- [x] F.7 ADR merged (Pull approach formalized; D3/D4 unblocked)
- [x] F.6 numeric namespace map ready for C9 consumption
- [x] F.5 compat map ready for C8 consumption
- [x] F.2 lock strategy ready for B1/B2 consumption
- [x] F.3 timeout matrix ready for D4 consumption
- [x] F.4 baseline sketch ready; live numbers attach in A2 PR
- [x] F.1 measurement path documented (deferred to A2)

**Phase A is unblocked**. Next action: dispatch A1 (architect ADR sign-off, 0.25d) → A2 (managed emitter, 1.5d).
