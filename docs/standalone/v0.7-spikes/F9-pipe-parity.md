# F.9 -- Named-Pipe vs Unix-Socket Reload Parity

## Status

Phase 0 spike. Windows analysis: complete (this session). macOS verification: TBD.

## Goal

Confirm `/liveness` route serves during Unity domain reload window on both platforms;
document any platform-specific quirks Phase A A4 must handle.

## Reload window timeline (canonical)

```
T0:        Unity invokes AssemblyReloadEvents.beforeAssemblyReload
T0+e:      UnictlServer.OnBeforeReload() calls unictl_unregister_handler()
           -> Rust HANDLER (lib.rs:21) becomes None
           -> EditorApplication.update -= ProcessMainQueue  (UnictlServer.cs:84)
           -> StopInternalListener("before reload")         (UnictlServer.cs:85)
T0+e..T1:  domain reload in progress (variable, p50 ~5s, p99 ~25s)
T1:        [InitializeOnLoad] static ctor fires
           -> unictl_start() is a no-op (STARTED already true, lib.rs:52-54)
           -> unictl_register_handler() restores HANDLER    (lib.rs:191)
           -> StartInternalListener() resets internal port   (UnictlServer.cs:59)
```

Key invariant: `unictl_start` (lib.rs:50-73) is guarded by `STARTED` and only spawns
transport threads once per DLL lifetime. The Rust accept loops in
`server_windows::pipe_instance_loop` and `server_unix::start` keep running across
every domain reload. Only `HANDLER` transitions from `Some` to `None` and back.

---

## Windows named-pipe behavior (analyzed)

### Existing impl (server_windows.rs)

`server_windows::start` (line 21) spawns one supervisor thread that in turn spawns
four worker threads (lines 25-29), each running `pipe_instance_loop` indefinitely.

Each iteration of `pipe_instance_loop` (lines 35-83):
1. Checks `SHUTDOWN` -- the only way to stop the loop.
2. Calls `CreateNamedPipeW` with `PIPE_UNLIMITED_INSTANCES` (lines 44-55). This
   creates a fresh pipe instance each time, so instance count is bounded only by
   available kernel resources, not a hardcoded limit (see Quirks).
3. Blocks in `ConnectNamedPipe` (line 63) waiting for a client.
4. Calls `handle_pipe_client(handle)` synchronously (line 75) -- the thread is
   occupied for the duration of the connection.
5. On return, calls `DisconnectNamedPipe` + `CloseHandle` (lines 79-80), then loops.

`handle_pipe_client` (lines 85-134) reads a newline-delimited JSON line and calls
`process_json_line` -> `route_request` (protocol.rs:7).

### What happens during T0+e..T1

**In-flight connection at T0+e.** If `handle_pipe_client` is blocked in `ReadFile`
(line 93) when `OnBeforeReload` fires, the pipe handle is still open on the Rust
side. `HANDLER` becoming `None` has no direct effect on a blocked `ReadFile` -- the
Win32 handle lifetime is independent of the managed callback pointer. The read
completes normally when the client sends data.

**Request arrives while HANDLER is None (lib.rs:77-91).** The `handle_command`
function acquires `HANDLER` lock (lib.rs:78), matches `None` (lib.rs:84), and
executes the deferred path:
- Pushes `body` into `MAIN_QUEUE` (lib.rs:87).
- Returns `{"accepted":true,"id":"...","deferred":true}` (lib.rs:89).
This response is written back to the pipe client immediately. The queued body will
be processed by `ProcessMainQueue` after T1 when `EditorApplication.update` is
re-registered. The requesting CLI receives a 200-equivalent JSON acknowledgement
during the reload window; it is the CLI's responsibility to poll for the deferred
result.

**`/liveness` route (see section below).** `route_request` in protocol.rs is called
before `handle_command`, so `/liveness`-equivalent logic can be evaluated first. See
A4 implementation guidance for the recommended split.

**Accept loop continuity.** `pipe_instance_loop` keeps creating new pipe instances
and accepting connections throughout T0+e..T1 because the loop only checks
`SHUTDOWN`, not `HANDLER`. A client connecting during reload will get a response
(either deferred or `/liveness`).

**Internal HttpListener down.** `StopInternalListener("before reload")` is called at
T0+e (UnictlServer.cs:85). `INTERNAL_PORT` is NOT reset to 0 by the Rust side --
`unictl_set_internal_port` is only called from C#. The `wake_via_http` path
(lib.rs:143-161) will attempt TCP connects to the now-closed port during reload;
those connects will fail with ECONNREFUSED, `wake_via_http` silently ignores the
error (lib.rs:152: `if let Ok(...)` swallows failure). This means async commands
queued during reload will not have their wake path working until T1 restores the
listener and calls `unictl_set_internal_port` again. Commands queued during reload
will be drained at the next `ProcessMainQueue` tick after T1 without needing the
wake path.

### /liveness during reload (A4 requirement)

**Current state of protocol.rs (lines 7-16):** the only two routes are `/health`
(which reads `HANDLER.is_some()`) and `/command`. There is no `/liveness` route yet.

**What A4 must build.** `/liveness` must be served by Rust alone with no managed
callback. The F.8 ADR mandates JSON-over-pipe with no `repr(C)` structs crossing the
boundary, so the liveness state must live in a Rust-owned static populated by the
managed side via a P/Invoke call before `unictl_unregister_handler()`.

Concretely:
- Add a `static LIVENESS: Mutex<LivenessState>` (or equivalent atomics) to lib.rs.
- Add an export `unictl_set_liveness(json_ptr)` (or field-level exports) so the
  managed heartbeat emitter (A2) can write state each frame.
- In `protocol.rs::route_request`, add a `("GET", "/liveness")` arm that reads
  `LIVENESS` and returns the stored JSON -- no call to `handle_command`, no
  `HANDLER` check.
- During T0+e..T1, the last heartbeat written before `OnBeforeReload` is readable
  via `/liveness`; A4 layers on a `since_ms` elapsed calculation and flips state to
  `"reloading"` once a staleness threshold is crossed (30s ceiling per A4 AC).

This path is fully Rust-only and works identically on Windows (named pipe read path
in `handle_pipe_client`) and on macOS (HTTP request path in `server_unix`).

Evidence that `/health` already follows this pattern: protocol.rs:9-11 reads
`HANDLER.is_some()` without calling managed code, proving the routing layer can
answer inline from Rust statics.

### Quirks

**PIPE_UNLIMITED_INSTANCES (server_windows.rs:49).** The code passes
`PIPE_UNLIMITED_INSTANCES` to `CreateNamedPipeW`, which sets the max-instance count
to 255 (the Win32 documented maximum for this constant). With four concurrent worker
threads each holding one instance at a time during connection handling, the effective
concurrent connection limit is 4. Additional clients will block in the OS `CreateFile`
call until a worker loops back and creates a new instance. This is not a reload-
specific issue but matters for load under a queue of deferred commands.

**ERROR_BROKEN_PIPE (Win32 error 109).** If the CLI client disconnects before
`WriteFile` completes (e.g. the client times out during a long reload), `WriteFile`
returns `ERROR_BROKEN_PIPE`. `handle_pipe_client` does not check `WriteFile` return
values (lines 123-131: `let _ = unsafe { WriteFile(...) }`). The error is silently
discarded; the read loop will see `ReadFile` fail or return 0 bytes on the next
iteration and exit cleanly (line 101: `if ok.is_err() || bytes_read == 0 { break }`).
The pipe instance is then disconnected and closed normally (lines 79-80), and the
worker loops to create a new instance. No leak.

**ERROR_PIPE_CONNECTED (Win32 error 535).** `ConnectNamedPipe` may return this error
if a client connected between `CreateNamedPipeW` and `ConnectNamedPipe` (fast client).
The code handles this correctly at lines 64-71: only this error is tolerated; all
others close the handle and continue.

**SHUTDOWN flag latency.** The `SHUTDOWN` AtomicBool (lib.rs:17) is checked at the
top of `pipe_instance_loop` (line 39) only, not inside `ConnectNamedPipe` (which
blocks indefinitely). If `SHUTDOWN` is set while a worker is blocked waiting for a
client, that worker will not notice until a client connects and the connection is
handled. This is an existing pre-v0.7 issue and does not affect reload semantics
(reload does not set `SHUTDOWN`).

**No overlapped I/O.** All pipe I/O is synchronous (`PIPE_WAIT`, line 12). A slow
client reading the response can block a worker thread for the full duration. Four
workers means up to four slow clients can stall the pipe entirely. For `/liveness`
this is not a problem (response is a small JSON blob), but it is a concern for long-
running `/command` responses.

---

## Unix-socket behavior (TBD -- macOS verification needed)

### Code-level analysis (this session)

`server_unix::start` (server_unix.rs:8-56) uses `tiny_http` over a Unix domain
socket. Structural differences from the Windows implementation:

**Socket file lifecycle.** At startup, `server_unix::start` removes any stale socket
file with `std::fs::remove_file(path)` (line 13) before binding. The socket inode
persists on the filesystem for the lifetime of the `Server` object (until the process
exits or the `Server` is dropped). Unlike Windows named pipes, the socket path is a
real filesystem entry visible to `ls`. If the process crashes without cleanup, the
stale socket file remains and must be deleted before the next `unictl_start` call --
which the code already handles via the `remove_file` at line 13.

**Single accept loop vs four workers.** `server_unix::start` spawns one thread that
iterates `server.incoming_requests()` (line 24). `/health` is handled inline (lines
29-35). All other requests are dispatched to a new per-request thread (lines 38-51).
There is no fixed worker-thread pool; concurrency is limited only by OS thread limits.
This is architecturally different from Windows (4 fixed workers vs N ephemeral
threads).

**HTTP framing vs raw pipe framing.** The Unix side uses full HTTP/1.1 framing via
`tiny_http`. The Windows side uses a custom newline-delimited JSON protocol over a
raw byte pipe. The CLI must speak different wire protocols depending on platform.
`/liveness` will need to be added to protocol.rs (shared) but the transport layer
that delivers the bytes differs: on Unix, a standard HTTP GET; on Windows, a JSON-
line `{"method":"GET","path":"/liveness","body":{}}`.

**HANDLER None behavior.** `server_unix` calls `route_request` (line 47) from
`server_unix.rs`, which follows the same `protocol.rs::route_request` code path as
Windows. The `HANDLER -> None` behavior during reload is therefore identical: deferred
queue for `/command`, inline response for `/liveness` (once A3 adds the route).

**Filesystem-level differences from Windows named pipe.**
- Socket inode is a real file entry; `stat(2)` on the path can detect the process is
  listening.
- A stale socket (process died) will cause `connect(2)` from a client to fail with
  `ECONNREFUSED`, not a Windows-style "pipe not found" error. The CLI reconnect logic
  must handle both error forms.
- `EAGAIN`/`EWOULDBLOCK` on non-blocking accept is not relevant here: `tiny_http`
  uses blocking accept internally; the single accept-loop thread blocks until a
  connection arrives. There is no explicit non-blocking flag in the current code.
- The socket path on macOS is `<project_root>/.unictl/unictl.sock`
  (UnictlServer.cs:287). Path length on macOS is capped at 104 bytes by the kernel
  (`sun_path` field in `sockaddr_un`). Deep project root paths risk exceeding this
  limit. Windows named pipe names use `\\.\pipe\unictl-<8-char-hash>` (UnictlServer.cs:282)
  and are not subject to this constraint. A4 / A3 must validate socket path length on
  macOS.

### What needs live verification on macOS

The following behaviors have not been observed on a live macOS Unity instance and must
be verified before the parity matrix is marked complete:

1. **Reload window observation.** Confirm `server.incoming_requests()` continues
   iterating (i.e., `tiny_http` does not block or error) during a Unity domain reload.
   The tiny_http server holds the socket fd; there is no C# involvement in the accept
   loop, so it should continue -- but actual reload duration and any OS-level socket
   backlog pressure need to be measured.
2. **Socket inode lifecycle.** Confirm the socket file at `.unictl/unictl.sock` is not
   unlinked or made inaccessible during domain reload (it should not be, since Rust
   owns the fd, not C#).
3. **`/liveness` response timing.** Measure time from `OnBeforeReload` to first
   `/liveness` response during reload window. Should be sub-millisecond (Rust inline),
   but tiny_http thread scheduling on macOS under Mono GC pressure is unknown.
4. **`sun_path` length.** Measure path length for typical Xcode/Unity install locations
   (e.g. `/Users/<user>/Projects/<name>/.unictl/unictl.sock`) and confirm it stays
   under 104 bytes.

### Recommended verification approach

1. Add a smoke test in `sandbox/UnictlSmokeProject` that:
   a. Triggers a domain reload via `CompilationPipeline.RequestScriptCompilation()`.
   b. Polls `/liveness` every 100ms from a background CLI process.
   c. Records the first timestamp where state becomes `"reloading"` and the first
      where it returns to `"idle"`.
   d. Asserts no 5xx or connection-refused responses during the reload window.
2. Run on a macOS CI runner (or local Mac) with Unity 6 LTS.
3. Record `since_ms` values in a log file and attach to the F.9 verification PR.

---

## Parity matrix

| Behavior | Windows (analyzed) | macOS (TBD) | Implementation impact |
|---|---|---|---|
| Transport accept loop persists across reload | Yes -- `pipe_instance_loop` checks only `SHUTDOWN`, not `HANDLER` (server_windows.rs:39) | Expected yes -- `server.incoming_requests()` is Rust-owned; TBD live | A4 reload envelope relies on this; must be verified on macOS |
| HANDLER becomes None at T0+e | Yes -- `unictl_unregister_handler` sets `HANDLER` to None (lib.rs:195-197) | Yes -- same lib.rs code path | Both platforms: /liveness must NOT call handle_command |
| Requests during reload get deferred response | Yes -- `handle_command` None branch returns accepted+deferred (lib.rs:84-91) | Yes -- same lib.rs code path | CLI must understand deferred envelope; poll after T1 |
| /liveness servable Rust-only | Yes -- `route_request` can add GET /liveness arm reading a Rust static (protocol.rs:7-16 pattern) | Yes -- same protocol.rs code path | A3 must add route; A2 must populate static before unregister |
| Connection dropped during reload window | No -- pipe handle survives; ReadFile/WriteFile continue normally | TBD -- socket fd Rust-owned, expected same; TBD live | CLI reconnect logic: assume connection persists; error = actual drop |
| Internal HttpListener down during reload | Yes -- StopInternalListener at T0+e; INTERNAL_PORT stale in Rust (UnictlServer.cs:85) | Yes -- same C# path | wake_via_http silently fails during reload (lib.rs:152); deferred commands drain at T1 without wake |
| Socket/pipe path length constraint | None -- hash-based name is fixed length (UnictlServer.cs:282) | Risk -- sun_path <= 104 bytes on macOS; TBD measurement | A3/server_unix.rs: add path length assertion at startup |
| Stale endpoint after crash | Named pipe: OS reclaims when all handles close | Socket inode persists on disk; `remove_file` at next start handles it (server_unix.rs:13) | No code change needed for reload; crash recovery already handled |
| Concurrent connection limit | 4 workers * PIPE_UNLIMITED_INSTANCES; additional clients queue in OS | N ephemeral threads per request; OS thread limit applies | Not a reload issue; document in operator runbook |

---

## A4 implementation guidance derived from this analysis

**1. Add `/liveness` as a pre-HANDLER route in protocol.rs.**
The dispatch in `protocol.rs::route_request` (lines 7-16) is evaluated before any
`HANDLER` check. Add the `/liveness` arm first in the match, reading from a new
`static LIVENESS` in lib.rs. This ensures the route is answered without acquiring
`HANDLER` lock. Pattern proven by `/health` at protocol.rs:9-11.

**2. Populate LIVENESS before calling `unictl_unregister_handler`.**
`OnBeforeReload` (UnictlServer.cs:81-86) currently calls `unictl_unregister_handler`
first. A2's heartbeat emitter should write a final heartbeat record (with
`state:"reloading"`) via the new export before unregister fires, so the Rust static
holds a valid record for the entire T0+e..T1 window. Ordering:
```
unictl_set_liveness(reloading_json);  // new -- write final state
unictl_unregister_handler();          // existing -- clears HANDLER
EditorApplication.update -= ...;      // existing
StopInternalListener(...);            // existing
```

**3. All other routes return 503 during reload -- enforce in protocol.rs.**
Add a `static RELOAD_ACTIVE: AtomicBool` (or derive it from `HANDLER.is_none()`).
In the `/command` arm (protocol.rs:13), check the flag before calling `handle_command`
and return the `editor_reload_active` 503 envelope. The deferred path in `handle_command`
(lib.rs:84-91) provides an alternative (accepted+deferred), but A4 AC requires 503
for non-liveness routes, not deferred. Choose: either change the None branch to return
503, or route at the protocol level.

**4. `since_ms` calculation is purely Rust-side.**
Store the `std::time::Instant` of the last received heartbeat in the `LIVENESS`
static. When serving `/liveness`, compute `since_ms = last_heartbeat_instant.elapsed().as_millis()`.
This satisfies the R16 monotonic clock requirement and requires no managed involvement
during reload.

**5. Windows pipe: no changes to the accept loop needed.**
`pipe_instance_loop` already runs independent of `HANDLER`. The four-worker model
gives sufficient concurrency for `/liveness` polling (small response, fast path).
No overlapped I/O or additional threads are required for A4.

**6. macOS: verify sun_path length before A3 implementation.**
Before writing `server_unix.rs` changes for A3, add a `assert!(path.len() < 104)`
(or a proper error return) in `server_unix::start`. If path length is a real concern
on CI Mac runners, switch to a hash-abbreviated path strategy matching Windows.

---

## Deferred items

- macOS live verification of all TBD rows in the parity matrix (next macOS session
  or CI matrix run -- see Recommended verification approach above).
- sun_path length measurement on macOS CI runner with representative project path.
- Cross-platform regression test in `mise run check:heartbeat` (Phase A6 / B7) -- 
  must cover reload boundary on both platforms.
- Confirmation that `tiny_http`'s `incoming_requests()` iterator does not block or
  return an error when the socket backlog fills during a long reload on macOS.
- Decision on deferred-vs-503 for non-liveness routes during reload (see A4 guidance
  point 3); needs architect sign-off at A1.
