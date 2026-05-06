# F.4 -- Transport Throughput Baseline

## Purpose

Establish a baseline for the existing pipe transport so Phase D D8 can detect
regression.  The baseline covers two layers: the in-process Rust queue
(`MAIN_QUEUE`) that sits on every async command path, and the Windows named-pipe
round-trip that carries every CLI request.  Numbers recorded here become the
D8 acceptance threshold: a p99 increase of more than 50 % relative to this
baseline is a regression and must be investigated before merging.

---

## What is measured

### Rust-side (in-process, no editor required)

| Target | What | Why |
|--------|------|-----|
| `MAIN_QUEUE` push (1 thread) | `Mutex<Vec<String>>::lock + push` | Baseline contention cost on the hot async path |
| `MAIN_QUEUE` push (8 threads) | Same, 8 concurrent lockers | Simulates 8 simultaneous CLI calls queued for the main thread |
| `MAIN_QUEUE` pop (1 thread) | `lock + remove(0)` | `unictl_pop_main` is called every editor frame; `remove(0)` is O(n) shift -- must stay cheap at realistic queue depths (0-3 items) |
| JSON field extraction | `extract_field` on a 256-byte payload | Called on every `/command` body; measures string scan cost |
| `CString::new` allocation | Conversion from `String` to `CString` | Done on every handler call-site and every `unictl_pop_main` return |
| Named-pipe `WriteFile` + `FlushFileBuffers` (256 B) | Single-client loopback write | Floor for write cost before any routing |
| Named-pipe write + read round-trip (256 B) | Client writes request line, reads response line | Full in-process loopback; no Unity, no C# handler |

### CLI-side (requires a live editor -- document methodology only)

| Target | What |
|--------|------|
| `unictl_ping` cold (first call) | CLI spawn + pipe connect + `GET /health` + disconnect |
| `unictl_ping` warm (Nth call, pipe already connected) | Same minus spawn overhead |
| `unictl_counter` round-trip | `POST /command` with a sync C# handler returning immediately |
| Concurrent ping x8 | 8 parallel CLI processes connecting simultaneously |
| Async command round-trip | `POST /command` where handler returns NULL, queued via `MAIN_QUEUE`, `unictl_respond` called from main thread |

---

## Rust-side measurement plan

`criterion` is **not** present in `Cargo.toml` and must not be added without a
coordinated dependency review.  The plan below describes exactly what a
criterion benchmark suite would look like so it can be added in a single diff
when approved.  As an interim option, a `#[cfg(test)]` timing harness using
`std::time::Instant` is provided; it ships zero production code and zero new
deps.

### Criterion sketch (add to `Cargo.toml` when approved)

```toml
# [dev-dependencies] -- add under coordination
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "transport"
harness = false
```

File would live at `native/unictl_native/benches/transport.rs`.  Sketch:

```rust
// benches/transport.rs -- criterion sketch; NOT compiled into release
// Requires: criterion = "0.5" in [dev-dependencies]

use criterion::{criterion_group, criterion_main, BenchmarkId, Criterion, Throughput};
use std::sync::{Arc, Mutex};

// ---------- MAIN_QUEUE push/pop ----------

fn bench_queue_push_single(c: &mut Criterion) {
    let q: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let payload = r#"{"id":"abc123","method":"ping"}"#.to_owned();

    c.bench_function("queue_push_1_contender", |b| {
        b.iter(|| {
            q.lock().unwrap().push(payload.clone());
            q.lock().unwrap().clear(); // keep depth at ~0
        })
    });
}

fn bench_queue_push_8_contenders(c: &mut Criterion) {
    let q: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let payload = r#"{"id":"abc123","method":"ping"}"#.to_owned();
    let mut handles = vec![];

    // Spin up 7 background threads before the benchmark loop so they are
    // competing for the lock during measurement.
    for _ in 0..7 {
        let q2 = q.clone();
        let p2 = payload.clone();
        handles.push(std::thread::spawn(move || loop {
            q2.lock().unwrap().push(p2.clone());
            std::thread::yield_now();
        }));
    }

    c.bench_function("queue_push_8_contenders", |b| {
        b.iter(|| {
            q.lock().unwrap().push(payload.clone());
        })
    });
    // Note: background threads leak after bench -- acceptable in bench binary.
    drop(handles);
}

fn bench_queue_pop(c: &mut Criterion) {
    let q: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
    let payload = r#"{"id":"abc123","method":"ping"}"#.to_owned();

    c.bench_function("queue_pop_depth_1", |b| {
        b.iter(|| {
            q.lock().unwrap().push(payload.clone());
            let mut guard = q.lock().unwrap();
            if !guard.is_empty() {
                guard.remove(0);
            }
        })
    });
}

// ---------- JSON field extraction ----------

fn bench_extract_field(c: &mut Criterion) {
    // Representative async command body (~256 B)
    let body = r#"{"id":"req-0001","method":"POST","path":"/command","body":{"command":"editor_compile","args":{}}}"#;

    c.bench_function("extract_field_id", |b| {
        b.iter(|| {
            // mirrors extract_field() in lib.rs
            let needle = "\"id\"";
            let _ = body.find(needle);
        })
    });
}

// ---------- CString allocation ----------

fn bench_cstring_alloc(c: &mut Criterion) {
    let payload = r#"{"id":"req-0001","accepted":true,"deferred":false}"#.to_owned();

    c.bench_function("cstring_new_48b", |b| {
        b.iter(|| {
            let _ = std::ffi::CString::new(payload.clone()).unwrap();
        })
    });
}

// ---------- Named-pipe loopback (Windows only) ----------
// Criterion cannot easily drive async I/O across threads in a bench harness;
// use the std::time::Instant test below for pipe round-trip numbers.

criterion_group!(
    benches,
    bench_queue_push_single,
    bench_queue_push_8_contenders,
    bench_queue_pop,
    bench_extract_field,
    bench_cstring_alloc,
);
criterion_main!(benches);
```

### Interim std::time::Instant harness (no new deps, ships as #[cfg(test)])

Add inside `lib.rs` or a new `#[cfg(test)] mod bench_transport` module:

```rust
#[cfg(test)]
mod bench_transport {
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    const ITERS: u64 = 100_000;

    #[test]
    #[ignore] // run with: cargo test bench_ -- --ignored --nocapture
    fn bench_queue_push_single_contender() {
        let q: Mutex<Vec<String>> = Mutex::new(Vec::new());
        let payload = r#"{"id":"abc123","method":"ping"}"#.to_owned();
        let t0 = Instant::now();
        for _ in 0..ITERS {
            q.lock().unwrap().push(payload.clone());
            q.lock().unwrap().clear();
        }
        let elapsed = t0.elapsed();
        println!(
            "queue_push_single: total={:?}  per_op={:.0}ns",
            elapsed,
            elapsed.as_nanos() as f64 / ITERS as f64
        );
    }

    #[test]
    #[ignore]
    fn bench_queue_push_8_contenders() {
        let q = Arc::new(Mutex::new(Vec::<String>::new()));
        let payload = r#"{"id":"abc123","method":"ping"}"#.to_owned();
        let barrier = Arc::new(std::sync::Barrier::new(9));

        let mut handles = vec![];
        for _ in 0..8 {
            let q2 = q.clone();
            let p2 = payload.clone();
            let b2 = barrier.clone();
            handles.push(std::thread::spawn(move || {
                b2.wait();
                for _ in 0..ITERS {
                    q2.lock().unwrap().push(p2.clone());
                }
            }));
        }

        barrier.wait();
        let t0 = Instant::now();
        for h in handles { h.join().unwrap(); }
        let elapsed = t0.elapsed();
        println!(
            "queue_push_8_contenders: total={:?}  per_op={:.0}ns (8 * {} iters)",
            elapsed,
            elapsed.as_nanos() as f64 / (8 * ITERS) as f64,
            ITERS
        );
    }

    #[test]
    #[ignore]
    fn bench_named_pipe_loopback() {
        // Server: create a named pipe, accept one client, echo each line.
        // Client: connect, write N JSON lines, read N responses, record times.
        // This test is Windows-only; it will be skipped on macOS by the
        // #[cfg(target_os = "windows")] guard added at call-site.
        //
        // Implementation left as a stub: wiring the Windows pipe API inside
        // a test module requires the `windows` crate in [dev-dependencies],
        // which also needs coordinator approval.  Measure manually using the
        // CLI loopback script described in the CLI-side section instead.
        println!("bench_named_pipe_loopback: deferred -- see CLI-side plan");
    }
}
```

Run with:

```
cargo test bench_ -- --ignored --nocapture
```

---

## CLI-side measurement plan (requires editor)

All CLI-side numbers require:
- Unity editor open with the sandbox project (`sandbox/UnictlSmokeProject`)
- `unictl start` succeeded (native bridge loaded, pipe listening)
- Measurements recorded with PowerShell `Measure-Command` or `hyperfine`

### Method

```powershell
# Warm-up: ensure pipe is already listening
bunx unictl ping

# p50/p99 via hyperfine (install: scoop install hyperfine)
hyperfine --warmup 5 --runs 100 "bunx unictl ping"
hyperfine --warmup 5 --runs 100 "bunx unictl counter"

# Concurrent: 8 parallel invocations
1..8 | ForEach-Object -Parallel { bunx unictl ping } | Measure-Object -Property TotalMilliseconds -Average -Maximum
```

Expected recording format (fill in after actual measurement):

```
cold_ping_ms_p50:    <fill>
cold_ping_ms_p99:    <fill>
warm_ping_ms_p50:    <fill>
warm_ping_ms_p99:    <fill>
counter_ms_p50:      <fill>
counter_ms_p99:      <fill>
concurrent_8_max_ms: <fill>
measured_on:         <date, Windows version, Rust toolchain, Unity version>
```

Save the filled record to `docs/standalone/v0.7-spikes/F4-baseline-numbers.txt`
when Phase D starts.

---

## Expected baseline ranges

These are analytic estimates derived from the transport implementation.
"Warm" means the pipe server thread is already blocked on `ConnectNamedPipe`
or `ReadFile`; "cold" means CLI must spawn a Node/Bun process first.

| Metric | Expected p50 | Expected p99 | Notes |
|--------|-------------|-------------|-------|
| `MAIN_QUEUE` push, 1 contender | ~50 ns | ~200 ns | Single `Mutex` acquire + `Vec::push`; no allocation if capacity available |
| `MAIN_QUEUE` push, 8 contenders | ~500 ns | ~2 us | Lock convoy under high concurrency; `Vec` allocation amortized |
| `MAIN_QUEUE` pop (depth 1) | ~80 ns | ~300 ns | `remove(0)` on a 1-item Vec is O(1) in practice; cost grows with depth |
| `extract_field` (256 B body) | ~30 ns | ~80 ns | Linear scan; short-circuits on first match |
| `CString::new` (48 B) | ~40 ns | ~120 ns | One heap alloc + memcpy + nul scan |
| Named-pipe `WriteFile` 256 B (loopback) | ~5 us | ~20 us | Kernel named-pipe, same machine; FlushFileBuffers adds ~1 us |
| Named-pipe write+read round-trip 256 B (loopback, warm) | ~15 us | ~50 us | Both sides in-process loopback; no C# handler |
| `unictl ping` CLI round-trip (warm, Bun already cached) | ~3 ms | ~10 ms | Bun startup ~2 ms + pipe connect + one GET /health |
| `unictl ping` CLI round-trip (cold, first Bun invocation) | ~80 ms | ~200 ms | Node/Bun process spawn dominates |
| `unictl counter` CLI round-trip (warm) | ~4 ms | ~12 ms | Same as ping + `POST /command` + sync C# handler |
| Async command round-trip (warm, C# queues + responds) | ~5 ms | ~20 ms | Adds main-thread wake via HTTP + `unictl_respond` P/Invoke |
| Concurrent ping x8 (warm) | ~5 ms max | ~15 ms max | 4 pipe instances available; 8 callers queue across them |

Notes on the analytic estimates:
- Named-pipe numbers are for a synchronous byte-mode pipe with
  `FlushFileBuffers` after every write, which is the current implementation.
  Removing `FlushFileBuffers` would drop write cost ~30 % but risks
  partial-read on the client; not proposed for v0.7.
- CLI cold-start numbers are dominated by Bun/Node process spawn, not by
  the Rust transport.  D8 should measure warm numbers to isolate transport
  regression from toolchain variance.
- The F.1 heartbeat budget is p99 < 200 us for the emitter path.  The
  transport itself at ~50 us p99 (pipe write) leaves ~150 us budget for
  the managed-side serialization and the Rust receiver, which is tight but
  feasible with a pre-allocated buffer (R3 mitigation).

---

## How D8 uses this baseline

D8 (crash-mid-wait sandbox test) also gates on transport regression
detection.  The rule is:

> A p99 increase of more than 50 % relative to the baseline recorded in
> `F4-baseline-numbers.txt` is a regression and must be investigated before
> the D-series PR merges.

Concretely:

- If warm `unictl ping` p99 grows from 10 ms to > 15 ms, block the PR.
- If `MAIN_QUEUE` push p99 (8 contenders) grows from ~2 us to > 3 us,
  flag for performance-reviewer sign-off.
- The CLI cold-start number is excluded from the regression gate (it is
  dominated by Bun/Node spawn variance, not transport code).

The baseline file (`F4-baseline-numbers.txt`) is the source of truth; the
50 % threshold is intentionally loose to absorb CI machine variance while
still catching a 2x regression.

---

## Open questions / deferred to Phase A

1. **Pipe loopback bench with Windows API in test**: wiring `CreateNamedPipeW`
   + `ConnectNamedPipe` inside a `#[cfg(test)]` module requires the `windows`
   crate in `[dev-dependencies]`.  It is already in `[dependencies]` for the
   Windows target, but promoting it to `[dev-dependencies]` so tests compile
   on all platforms needs coordinator review.  Deferred.

2. **macOS unix-socket baseline**: `server_unix.rs` uses `tiny_http` over a
   Unix socket.  The latency profile differs (no `FlushFileBuffers`; HTTP
   framing instead of raw line protocol).  F.9 parity spike covers behavioral
   correctness; a macOS latency baseline is deferred to A3 when the liveness
   route is implemented and can be measured end-to-end.

3. **`unictl_pop_main` O(n) shift at depth > 1**: current implementation uses
   `Vec::remove(0)` which is O(n).  At realistic queue depths (0-3 items in
   steady state) this is negligible.  If D6 reload-aware waiting causes bursts
   of deferred commands, depth could spike; a `VecDeque` swap is a one-line
   fix.  Not proposed for v0.7 without evidence of a real problem.

4. **`wake_via_http` latency contribution**: the HTTP wake spawns a new
   `thread::spawn` per async command and loops at 50 ms until `wake_done` is
   set.  Under concurrent load this could produce many short-lived threads.
   Measuring this contribution requires a live editor and is deferred to A3.

5. **Heartbeat path not yet instrumented**: the F.1 heartbeat emitter does not
   exist yet.  Once A2/A3 land, add heartbeat-specific rows to the baseline
   table and re-run the Instant harness.

---

## Implementation status

- Rust microbenchmark: **not implemented** -- `criterion` is not in
  `Cargo.toml`; sketch provided above for when it is added under coordination.
  Interim `#[cfg(test)]` `#[ignore]` harness sketch provided; zero new deps,
  zero release impact.
- CLI E2E measurement: **deferred to A6** -- requires live editor + heartbeat
  code; methodology and recording format documented above.
