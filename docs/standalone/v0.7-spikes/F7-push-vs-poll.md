# F.7 -- Push vs Poll for `--wait` State Transitions (ADR)

## Status

Accepted (Phase 0, gates Phase D D3/D4).

## Context

unictl v0.7 introduces a top-level `--wait <state>` flag (Phase D) that promises
the CLI returns only after the editor reaches `idle | playing | compiling |
reloading | quit`, or a deterministic timeout fires. Underneath, `--wait`
consumes the heartbeat ABI shipped by Phase A: the managed emitter writes a
per-frame `{tick, last_heartbeat_ms, state, scene}` record, the Rust receiver
keeps the last record, and the route `GET /liveness` (A3) returns the
reload-aware envelope `{state, last_heartbeat_ms, since_ms, scene,
schema_version}`. A4 pins down reload semantics: during domain reload
`/liveness` keeps returning 200 with `state:"reloading"` and is the only route
guaranteed during reload; after 30s without heartbeat the state flips to
`unresponsive`.

Phase D3 needs to choose how the CLI learns about state transitions:

- **Option A -- Pull**: CLI polls `/liveness` at a fixed cadence.
- **Option B -- Push**: a new native export (`unictl_native_subscribe_phase`)
  delivers transitions without polling.

F.7's job is to pick one and either land the export skeleton or document the
polling fallback completely. F.8 already locked the ABI to JSON-over-pipe with
no `repr(C)` structs (`F8-abi-policy.md`), which constrains every option below.
The Phase 0 plan note states explicitly: "if push is rejected, D3/D4 fall back
to bounded polling against `/liveness`". This ADR exercises that fallback path
and rejects push.

## Decision

**Pull. `--wait` polls `GET /liveness` at a bounded cadence with backoff.**

No new native export is added in v0.7. `unictl_native_subscribe_phase` is
deferred to a v0.8+ ADR if and only if the reconsideration triggers below fire.

## Rationale

The push channel is rejected on four grounds. Each is decisive on its own; in
combination they leave no defensible argument for v0.7 push.

**1. Latency improvement is irrelevant against the F.3 timeout matrix.**
Per F.3, default `--wait` timeouts range from 15s (`editor play`) and 30s
(`editor stop`, `(any) reloading`, `(any) quit`) to 90s (`editor refresh`),
120s (`editor compile`), and 300s (`test editmode/playmode`). The push
proposal saves ~125ms p50 / ~250ms p95 per wait. That is rounding error
against the smallest budget on the matrix (15s = 0.83% improvement) and noise
against the largest (300s = 0.04%). `--wait` is an interactive / CI gating
verb, not an event-loop primitive. Spending implementation budget to shave
sub-second latency from a flag whose budget is measured in seconds-to-minutes
is the wrong trade.

**2. Reload survival is the entire reason the native plugin exists.**
The native bridge owns `MAIN_QUEUE`, `HANDLER`, `ASYNC_RESPONSES`, and
`INTERNAL_PORT` precisely because Mono AppDomain reload tears down the managed
side while the DLL keeps running. Today's design routes around reload by
parking commands in `MAIN_QUEUE` and replaying them when the new domain
re-registers a handler (see `lib.rs:77-92` `handle_command` `deferred:true`
path). A push channel must survive the same reload window. Each push variant
fails this test in v0.7's timeline:
  - **B1 (long-poll on `/liveness?subscribe=1`)**: the pipe stays open across
    reload but the managed-side phase emitter does not. The Rust side has no
    independent source of truth for "phase changed" -- it learns phases via
    `unictl_heartbeat`. During a reload there is no heartbeat by definition
    (A4: `since_ms` grows, eventually `unresponsive`). A long-poll that
    delivers the reload-entry transition still has to fall back to polling
    semantics during the reload window itself, which means we ship both
    transports.
  - **B2 (separate event pipe)**: same problem, plus a second platform-
    specific transport (named pipe + unix socket parity at F.9 doubles), plus
    a second connection lifecycle to manage in CLI. Brittleness for nothing.
  - **B3 (managed callback)**: the plan note already calls this out -- a
    managed callback dies on domain reload, defeating the purpose. Rejected
    upstream.
The pull path has no reload-survival problem: `/liveness` is the only route
guaranteed during reload (A4), so polling is the path the system was already
designed for.

**3. Implementation cost is 3x for the rejected option.**
Plan estimates: pull is ~1d (CLI poll loop + tests against the F.3 matrix);
push is ~3d (lifecycle + reload-resync + tests). Phase 0 has ~6.25d total
budget; spending 3d on push would consume ~half the spike phase against a
~125ms latency win on a flag whose smallest budget is 15,000ms.

**4. ABI surface area stays smaller.**
F.8 fixed v0.7 to JSON-over-pipe-only and additive-only. Pull adds zero new
exports. Push adds at least one (`unictl_native_subscribe_phase`) plus a new
streaming-JSON envelope shape on the wire that the schema-versioning policy
(`AGENTS.md` cross-phase concerns) has to track forever. Every export added is
a freeze obligation; the smallest viable surface wins, especially in a
0.x-series.

## Implementation specification (Pull, Option A)

### Endpoint and envelope

D3 consumers issue `GET /liveness` against the Rust HTTP route shipped in A3.
The reload-aware envelope (A3 / A4) is:

```json
{
  "state": "idle | playing | compiling | reloading | unresponsive | unknown",
  "last_heartbeat_ms": 1730000000123,
  "since_ms": 47,
  "scene": "Assets/Scenes/Sandbox.unity",
  "schema_version": 1
}
```

`unresponsive` is the post-30s-staleness state from A4. `unknown` covers the
cold-start window before the first heartbeat (added per the A4 cross-platform
parity check in F.9). Consumers must accept additional fields without erroring
(F.8 additive-only contract).

### Poll cadence

Default cadence is **250 ms** between requests in the active state. Rationale:

- F.3's smallest default timeout is 15 s (`editor play -> playing`); 250 ms
  cadence yields up to 60 polls within that budget, well above the
  statistical-significance floor for transition detection.
- 250 ms keeps p95 transition-detection latency at one full interval (250 ms),
  which is below the typical `--wait` user-perceived granularity.
- 250 ms is comfortably above `/liveness`'s p99 service budget of 5 ms (A3),
  so the CLI never piles requests on the receiver.
- 250 ms is the cadence already implied by the F.3 matrix (the "120s ceiling
  with 480 polls" budget that the F.3 doc reasons in).

The cadence is overridable by `UNICTL_WAIT_POLL_INTERVAL_MS` for operators who
need a different trade. The CLI clamps the env override to `[50, 5000]` ms;
out-of-range values fall back to 250 ms with a warning written to stderr (only
when `UNICTL_HUMAN=1`; under `--json` it surfaces as a `hint` field on the
envelope of the verb's first wait response).

### Backoff strategy

Three failure modes get distinct backoff:

1. **Connect refused / pipe-not-found**: editor not running, or starting up.
   Exponential backoff doubling from 250 ms with a 2 s ceiling. After the
   `(any) reachable = 120 s` budget from F.3, the wait fails with
   `code=<editor_not_running>` and `kind:"editor_not_running"`. Cap on retries
   is bounded by the timeout budget, not by an attempt count.
2. **`state:"reloading"` returned**: per A4 / D6, the timeout clock pauses and
   the CLI continues polling at the *same* 250 ms cadence (do not back off --
   reload window is bounded at 30 s ceiling and we want sharp re-arm on
   `idle`). The reloading state is the busy path, not the failure path.
3. **`state:"unresponsive"` returned**: heartbeat has gone past the 30 s
   staleness threshold. Surface immediately as `code=<editor_unresponsive>` /
   `kind:"editor_unresponsive"`. Do not backoff-and-retry; this is a terminal
   condition that requires operator attention.

Transport errors that are not `ConnectionRefused` (e.g. broken pipe mid-read
on Windows, ECONNRESET on Unix) get one immediate retry, then surface as
`code=<editor_unreachable>` / `kind:"editor_unreachable"`.

### Cancellation

`SIGINT` during `--wait` aborts the current poll, drops the timer, and exits
with code 130 / `kind:"interrupted"` per D7. Implementation: the poll loop
checks an `AbortController`-style cancellation token between requests; the
in-flight HTTP request itself is cancelled if SIGINT lands during the wire
read (Bun supports `AbortSignal` on `fetch`). No native-side cleanup is
required because the pull design opens no persistent state on the Rust side.

### Pseudocode for D3/D4

```ts
async function waitForState(
  targetState: WaitState,
  timeoutMs: number,
  cadenceMs = parsePollIntervalEnv() ?? 250,
): Promise<WaitOutcome> {
  const deadline = timeoutMs === 0 ? Infinity : Date.now() + timeoutMs;
  let pausedRemaining = 0;        // for reload-aware re-arm (D6)
  let reloadStartedAt: number | null = null;

  while (true) {
    if (signal.aborted) return { kind: "interrupted", code: 130 };

    const now = Date.now();
    if (now >= deadline && reloadStartedAt === null) {
      return { kind: "wait_timeout", code: 124 };
    }

    let live: LivenessEnvelope;
    try {
      live = await fetchLiveness({ signal });
    } catch (e) {
      if (isConnRefused(e)) {
        await sleep(backoffConnect.next(), signal);
        continue;
      }
      // one immediate retry, then surface
      try { live = await fetchLiveness({ signal }); }
      catch { return { kind: "editor_unreachable", code: codeFor("editor_unreachable") }; }
    }

    // A4 reload-aware re-arm
    if (live.state === "reloading") {
      if (reloadStartedAt === null) {
        reloadStartedAt = now;
        pausedRemaining = deadline - now;
      }
      if (now - reloadStartedAt > 30_000) {
        return { kind: "wait_timeout", code: 124, hint: "reload exceeded 30s ceiling" };
      }
      await sleep(cadenceMs, signal);
      continue;
    }

    // exit reload: re-arm clock from paused remaining
    if (reloadStartedAt !== null) {
      reloadStartedAt = null;
      // shift deadline forward by the reload duration
    }

    if (live.state === "unresponsive") {
      return { kind: "editor_unresponsive", code: codeFor("editor_unresponsive") };
    }

    if (matchesTarget(live.state, targetState)) {
      return { kind: "ok", code: 0, data: live };
    }

    await sleep(cadenceMs, signal);
  }
}
```

D4 wires this into `editor compile`, `editor play`, `editor stop`,
`editor refresh`, `test editmode`, `test playmode` (the explicit 6 verbs from
the plan, critic 3.1). Per-verb defaults come from F.3; the resolution order
is `--timeout` flag > `UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB>` env > compiled
default.

### Fixture parity (F.9 hook)

F.9 verifies `/liveness` reload behaviour on Windows named pipe and Unix
socket transports. The pull design has no transport-specific state, so F.9's
parity outcome covers the entire D3 consumer transparently.

## Alternatives considered

### B1 -- long-poll on `/liveness?subscribe=1`
Rejected. Pipe stays open across reload but heartbeat does not, so `--wait`
still has to fall back to polling for the reload window itself. We would ship
two transports (long-poll + the existing pull) when one suffices. The wire
envelope grows a streaming-JSON variant. Implementation budget triples.

### B2 -- second event pipe / socket
Rejected. Adds platform-specific transport surface (Windows named pipe + Unix
socket parity, F.9 doubled), a second connection lifecycle in CLI, and a
second reload-survival surface. Zero compensating benefit over A's pull path
once the latency-irrelevance argument lands.

### B3 -- managed callback registered with native
Rejected upstream by the plan note ("dies on domain reload, defeats purpose"),
re-confirmed here. The managed callback function pointer becomes invalid the
moment the AppDomain unloads; resubscribing on every reload is itself just a
poll loop with extra steps.

## Reconsideration triggers (when v0.8+ might revisit)

Any single trigger below justifies a fresh ADR; v0.7 does not change.

1. A new use case requires sub-100 ms reaction to a phase transition (for
   example: a future `unictl repl` where typing a command must block on
   compile completion in <1 frame). `--wait` does not qualify.
2. F.3 timeout matrix shrinks below 5 s for any verb such that 250 ms cadence
   becomes a meaningful fraction of the budget. Current minimum is 15 s.
3. Per-call CPU cost of pull becomes measurable in CI workloads -- documented
   threshold: median CI step adds >100 ms aggregate overhead from `--wait`
   polling across all verbs in one job. Measured by F.4 throughput baseline
   plus a CI post-merge probe.
4. A separate consumer outside CLI emerges that needs phase events (e.g. an
   IDE plugin observing the editor live). v0.7 plan's "Out of scope: IDE
   integrations beyond CLI invocation" lists this as a non-goal.

## Sign-off requirement

Per the v0.7 plan, Phase D D3/D4 depend on F.7's outcome. This ADR must be
signed off by the architect role before D3 implementation begins.
Sign-off scope: confirm that

- the polling design above is sufficient for D3/D4 acceptance criteria
  (transitions detected within 250 ms p95, F.3 timeouts honoured, reload-
  aware re-arm consistent with A4/D6, SIGINT handled per D7),
- the rejection of `unictl_native_subscribe_phase` is recorded as the v0.7
  decision and the export is not added speculatively,
- the reconsideration triggers are visible to anyone proposing push later.

D3 may begin implementation against this document once that sign-off lands.
The implementation must cite this ADR in its PR description for traceability.
