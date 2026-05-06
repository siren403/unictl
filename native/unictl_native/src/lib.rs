use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Instant;

mod protocol;

#[cfg(target_os = "macos")]
mod server_unix;
#[cfg(target_os = "windows")]
mod server_windows;

static COUNTER: AtomicI32 = AtomicI32::new(0);
static STARTED: AtomicBool = AtomicBool::new(false);
static SHUTDOWN: AtomicBool = AtomicBool::new(false);

// C# 콜백: NULL 반환 = 비동기, non-NULL = 동기
type CommandHandler = extern "C" fn(*const c_char) -> *const c_char;
static HANDLER: Mutex<Option<CommandHandler>> = Mutex::new(None);

// 비동기 응답 대기 채널: request_id → sender
static ASYNC_RESPONSES: Mutex<Option<HashMap<String, std::sync::mpsc::Sender<String>>>> =
    Mutex::new(None);

// 메인 스레드 실행 큐 (Domain Reload-safe, Rust static)
static MAIN_QUEUE: Mutex<Vec<String>> = Mutex::new(Vec::new());

// C# HttpListener 내부 포트 (main loop wake용)
static INTERNAL_PORT: AtomicI32 = AtomicI32::new(0);

// A3 typed liveness sink. Per A1 ADR + F.8: state_json is opaque UTF-8
// JSON shipped from managed; native does not parse it (additive-only contract,
// no struct shape commitment). Native captures monotonic Instant at receipt
// for staleness math; managed-side timestamp is shipped for forensics.
struct Liveness {
    last_heartbeat_ms: AtomicI64,             // managed-side monotonic ms (Stopwatch.GetTimestamp)
    last_managed_instant: Mutex<Option<Instant>>, // native-side monotonic capture (R16)
    state_json: Mutex<String>,                // last received raw payload
    pid: AtomicI32,                           // editor PID (filled by unictl_start)
}

static LIVENESS: Liveness = Liveness {
    last_heartbeat_ms: AtomicI64::new(0),
    last_managed_instant: Mutex::new(None),
    state_json: Mutex::new(String::new()),
    pid: AtomicI32::new(0),
};

/// Pure-function snapshot used by `format_liveness_response`. Extracted so A6
/// unit tests can exercise the formatter without touching the live `LIVENESS`
/// global.
pub(crate) struct LivenessSnapshot {
    pub last_heartbeat_ms: i64,
    pub pid: i32,
    pub raw_state: String,
    pub since_ms: i64,
    pub handler_registered: bool,
    pub threshold_ms: i64,
    pub native_version: &'static str,
}

/// Format the `/liveness` JSON body from a snapshot. Pure — no global reads.
///
/// `last_state` is inlined as raw JSON — the producer (managed) controls the
/// shape and validates it before sending. Native does not re-parse.
///
/// `phase_override` semantics:
///   - `"never_seen"`: heartbeat has never arrived (cold start before A2 emitter ran)
///   - `"unresponsive"`: last heartbeat older than `threshold_ms`
///   - `null`: alive (use `last_state.phase` as authoritative)
pub(crate) fn format_liveness_response(snap: &LivenessSnapshot) -> String {
    let last_state: &str = if snap.raw_state.is_empty() {
        "{}"
    } else {
        snap.raw_state.as_str()
    };

    let phase_override = if snap.since_ms < 0 {
        r#""never_seen""#
    } else if snap.since_ms > snap.threshold_ms {
        r#""unresponsive""#
    } else {
        "null"
    };

    format!(
        concat!(
            r#"{{"schema_version":1,"#,
            r#""alive_ms_ago":{},"#,
            r#""last_heartbeat_ms":{},"#,
            r#""last_state":{},"#,
            r#""pid":{},"#,
            r#""handler_registered":{},"#,
            r#""phase_override":{},"#,
            r#""native_version":"{}""#,
            r#"}}"#,
        ),
        snap.since_ms,
        snap.last_heartbeat_ms,
        last_state,
        snap.pid,
        snap.handler_registered,
        phase_override,
        snap.native_version
    )
}

/// Build the `/liveness` JSON response from current global state. Shared by
/// `unictl_get_liveness` export and the `("GET", "/liveness")` route.
pub(crate) fn build_liveness_response() -> String {
    let snap = LivenessSnapshot {
        last_heartbeat_ms: LIVENESS.last_heartbeat_ms.load(Ordering::SeqCst),
        pid: LIVENESS.pid.load(Ordering::SeqCst),
        raw_state: LIVENESS.state_json.lock().unwrap().clone(),
        since_ms: LIVENESS
            .last_managed_instant
            .lock()
            .unwrap()
            .as_ref()
            .map(|inst| inst.elapsed().as_millis() as i64)
            .unwrap_or(-1),
        handler_registered: HANDLER.lock().unwrap().is_some(),
        threshold_ms: std::env::var("UNICTL_RELOAD_THRESHOLD_MS")
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(30_000),
        native_version: env!("CARGO_PKG_VERSION"),
    };
    format_liveness_response(&snap)
}

// --- exports ---

#[unsafe(no_mangle)]
pub extern "C" fn unictl_ping() -> i32 { 42 }

#[unsafe(no_mangle)]
pub extern "C" fn unictl_counter() -> i32 {
    COUNTER.fetch_add(1, Ordering::SeqCst) + 1
}

#[unsafe(no_mangle)]
pub extern "C" fn unictl_set_internal_port(port: i32) {
    INTERNAL_PORT.store(port, Ordering::SeqCst);
}

// --- Server start (platform-dispatched) ---

#[unsafe(no_mangle)]
pub extern "C" fn unictl_start(path: *const c_char) -> i32 {
    if STARTED.load(Ordering::SeqCst) {
        return 0;
    }

    let path = unsafe { CStr::from_ptr(path) }
        .to_str()
        .unwrap_or("")
        .to_owned();
    if path.is_empty() { return -1; }

    *ASYNC_RESPONSES.lock().unwrap() = Some(HashMap::new());
    SHUTDOWN.store(false, Ordering::SeqCst);
    STARTED.store(true, Ordering::SeqCst);

    // A3: capture editor PID so /liveness can return it without a managed call.
    LIVENESS.pid.store(std::process::id() as i32, Ordering::SeqCst);

    #[cfg(target_os = "macos")]
    let result = server_unix::start(&path);

    #[cfg(target_os = "windows")]
    let result = server_windows::start(&path);

    result
}

// --- Command handling (shared across platforms) ---

fn handle_command(body: &str) -> String {
    let handler = HANDLER.lock().unwrap();
    match *handler {
        Some(cb) => {
            drop(handler);
            call_handler(cb, body)
        }
        None => {
            drop(handler);
            // A4: during a domain reload, return editor_reload_active envelope.
            // /liveness remains the only route servable while HANDLER is None.
            // Clients should poll /liveness and retry once phase != "reloading".
            //
            // BREAKING CHANGE vs v0.6: the old MAIN_QUEUE-deferred-accept path
            // is removed. v0.6 callers that relied on `{accepted:true, deferred:true}`
            // must migrate to the /liveness + retry pattern (or use --wait
            // which handles this transparently per F.7).
            //
            // Numeric `code` allocated by C9 in Phase C (ipc_* namespace per F.6).
            let id = extract_field(body, "id");
            format!(
                r#"{{"ok":false,"code":0,"kind":"editor_reload_active","message":"Editor is reloading; retry after /liveness reports phase != reloading","id":"{}"}}"#,
                id
            )
        }
    }
}

fn call_handler(cb: CommandHandler, body: &str) -> String {
    let c_body = CString::new(body).unwrap_or_default();
    let result_ptr = cb(c_body.as_ptr());

    if !result_ptr.is_null() {
        // 동기 응답 (list, ping, status)
        let result = unsafe { CStr::from_ptr(result_ptr) }
            .to_str()
            .unwrap_or(r#"{"error":"invalid_utf8"}"#)
            .to_owned();

        // CRITICAL: C# Marshal.StringToCoTaskMemUTF8 uses CoTaskMemAlloc on Windows,
        // but libc free() on macOS. Using the wrong deallocator causes heap corruption.
        #[cfg(target_os = "windows")]
        unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(result_ptr as *mut _)) };
        #[cfg(not(target_os = "windows"))]
        unsafe { libc_free(result_ptr as *mut _) };

        return result;
    }

    // 비동기: MAIN_QUEUE push + 응답 채널 등록 + HttpListener wake
    let id = extract_field(body, "id");
    let (tx, rx) = std::sync::mpsc::channel();
    if let Some(map) = ASYNC_RESPONSES.lock().unwrap().as_mut() {
        map.insert(id.clone(), tx);
    }

    MAIN_QUEUE.lock().unwrap().push(body.to_owned());
    // 동기화 배리어: push 직후 lock을 다시 획득해 메모리 가시성 보장.
    let _qlen = MAIN_QUEUE.lock().unwrap().len();

    // C# HttpListener에 wake 요청 → IO completion → main loop 활성화
    let wake_done = std::sync::Arc::new(AtomicBool::new(false));
    wake_via_http(wake_done.clone());

    let result = match rx.recv_timeout(std::time::Duration::from_secs(30)) {
        Ok(r) => r,
        Err(_) => {
            if let Some(map) = ASYNC_RESPONSES.lock().unwrap().as_mut() {
                map.remove(&id);
            }
            r#"{"error":"timeout","message":"main thread execution timeout"}"#.to_owned()
        }
    };
    wake_done.store(true, Ordering::Relaxed);
    result
}

/// C# HttpListener에 HTTP 요청을 보내 Unity main loop을 깨운다.
/// TCP localhost 기반이므로 macOS/Windows 모두 동작.
fn wake_via_http(wake_done: std::sync::Arc<AtomicBool>) {
    let port = INTERNAL_PORT.load(Ordering::SeqCst);
    if port <= 0 { return; }

    thread::spawn(move || {
        while !wake_done.load(Ordering::Relaxed) {
            use std::io::Write;
            if let Ok(mut s) = std::net::TcpStream::connect(("127.0.0.1", port as u16)) {
                let _ = s.write_all(b"GET /wake HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
                let _ = s.flush();
                let mut buf = [0u8; 64];
                let _ = std::io::Read::read(&mut s, &mut buf);
            }
            thread::sleep(std::time::Duration::from_millis(50));
        }
    });
}

fn extract_field(body: &str, field: &str) -> String {
    let needle = format!("\"{}\"", field);
    if let Some(start) = body.find(&needle) {
        let rest = &body[start + needle.len()..];
        let rest = rest.trim_start();
        let rest = if rest.starts_with(':') { &rest[1..] } else { rest };
        let rest = rest.trim_start();
        if rest.starts_with('"') {
            let rest = &rest[1..];
            if let Some(end) = rest.find('"') {
                return rest[..end].to_owned();
            }
        }
    }
    String::new()
}

// macOS: C runtime free() for Marshal.StringToCoTaskMemUTF8 (Mono uses malloc)
#[cfg(not(target_os = "windows"))]
unsafe extern "C" {
    #[link_name = "free"]
    fn libc_free(ptr: *mut std::ffi::c_void);
}

// --- 콜백 등록 ---

#[unsafe(no_mangle)]
pub extern "C" fn unictl_register_handler(handler: CommandHandler) {
    *HANDLER.lock().unwrap() = Some(handler);
}

#[unsafe(no_mangle)]
pub extern "C" fn unictl_unregister_handler() {
    *HANDLER.lock().unwrap() = None;
}

// --- 메인 스레드 큐 P/Invoke ---

#[unsafe(no_mangle)]
pub extern "C" fn unictl_pop_main() -> *mut c_char {
    let mut q = MAIN_QUEUE.lock().unwrap();
    if q.is_empty() { return std::ptr::null_mut(); }
    let item = q.remove(0);
    CString::new(item).unwrap_or_default().into_raw()
}

#[unsafe(no_mangle)]
pub extern "C" fn unictl_free_string(ptr: *mut c_char) {
    if !ptr.is_null() {
        unsafe { drop(CString::from_raw(ptr)); }
    }
}

// --- 비동기 응답 (C# main thread → Rust) ---

#[unsafe(no_mangle)]
pub extern "C" fn unictl_respond(request_id: *const c_char, response_json: *const c_char) {
    let id = unsafe { CStr::from_ptr(request_id) }.to_str().unwrap_or("").to_owned();
    let json = unsafe { CStr::from_ptr(response_json) }.to_str().unwrap_or("{}").to_owned();
    if let Some(map) = ASYNC_RESPONSES.lock().unwrap().as_mut() {
        if let Some(tx) = map.remove(&id) {
            let _ = tx.send(json);
        }
    }
}

// --- A3: heartbeat sink (managed → native) ---
//
// Receives heartbeat from managed and stores into typed LIVENESS.
// Per F.8: JSON-over-pipe only — `state_json` is null-terminated UTF-8.
// Per A1/A7: contract is additive-only; consumers must accept unknown fields.
// Per R16: native captures `Instant::now()` for staleness math (monotonic);
//   `timestamp_ms` is stored for forensics only and never used for math.
// Returns 0 on success, -1 on null/invalid UTF-8 payload.
#[unsafe(no_mangle)]
pub extern "C" fn unictl_heartbeat(timestamp_ms: i64, state_json: *const c_char) -> i32 {
    if state_json.is_null() {
        return -1;
    }
    let json = match unsafe { CStr::from_ptr(state_json) }.to_str() {
        Ok(s) => s.to_owned(),
        Err(_) => return -1,
    };

    LIVENESS.last_heartbeat_ms.store(timestamp_ms, Ordering::SeqCst);
    *LIVENESS.last_managed_instant.lock().unwrap() = Some(Instant::now());
    *LIVENESS.state_json.lock().unwrap() = json;
    0
}

// --- A3: liveness query (CLI / tooling consumer) ---
//
// Writes the JSON liveness response into caller-owned buffer.
// Returns bytes written, or -1 if buffer too small (caller should retry with
// larger buffer; a 1 KB buffer is sufficient in practice).
#[unsafe(no_mangle)]
pub extern "C" fn unictl_get_liveness(buf: *mut u8, len: usize) -> i32 {
    if buf.is_null() {
        return -1;
    }
    let response = build_liveness_response();
    let bytes = response.as_bytes();
    if bytes.len() > len {
        return -1;
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), buf, bytes.len());
    }
    bytes.len() as i32
}

// --- A6: unit tests for liveness response formatter ---

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(since_ms: i64, raw_state: &str, registered: bool) -> LivenessSnapshot {
        LivenessSnapshot {
            last_heartbeat_ms: 1234567890,
            pid: 4242,
            raw_state: raw_state.to_owned(),
            since_ms,
            handler_registered: registered,
            threshold_ms: 30_000,
            native_version: "0.7.0-test",
        }
    }

    #[test]
    fn never_seen_when_no_heartbeat_yet() {
        let snap = snapshot(-1, "", false);
        let response = format_liveness_response(&snap);
        assert!(
            response.contains(r#""phase_override":"never_seen""#),
            "response missing never_seen override: {}",
            response
        );
        assert!(
            response.contains(r#""last_state":{}"#),
            "empty payload should default to empty object: {}",
            response
        );
        assert!(response.contains(r#""alive_ms_ago":-1"#));
        assert!(response.contains(r#""handler_registered":false"#));
    }

    #[test]
    fn alive_when_recent_heartbeat() {
        let snap = snapshot(500, r#"{"phase":"idle","is_playing":false}"#, true);
        let response = format_liveness_response(&snap);
        assert!(
            response.contains(r#""phase_override":null"#),
            "alive should have null override: {}",
            response
        );
        assert!(response.contains(r#""alive_ms_ago":500"#));
        assert!(response.contains(r#""last_state":{"phase":"idle","is_playing":false}"#));
        assert!(response.contains(r#""handler_registered":true"#));
        assert!(response.contains(r#""pid":4242"#));
    }

    #[test]
    fn unresponsive_when_heartbeat_stale() {
        let snap = snapshot(60_000, r#"{"phase":"idle"}"#, false);
        let response = format_liveness_response(&snap);
        assert!(
            response.contains(r#""phase_override":"unresponsive""#),
            "stale heartbeat should be unresponsive: {}",
            response
        );
        // last_state still preserved so consumers see what the editor last reported.
        assert!(response.contains(r#""last_state":{"phase":"idle"}"#));
    }

    #[test]
    fn threshold_boundary_alive() {
        // Exactly at threshold = still alive (since_ms > threshold flips, not >=).
        let snap = snapshot(30_000, r#"{}"#, true);
        let response = format_liveness_response(&snap);
        assert!(response.contains(r#""phase_override":null"#));
    }

    #[test]
    fn threshold_boundary_unresponsive() {
        let snap = snapshot(30_001, r#"{}"#, false);
        let response = format_liveness_response(&snap);
        assert!(response.contains(r#""phase_override":"unresponsive""#));
    }

    #[test]
    fn schema_version_is_present() {
        let snap = snapshot(0, r#"{}"#, true);
        let response = format_liveness_response(&snap);
        assert!(
            response.starts_with(r#"{"schema_version":1,"#),
            "schema_version must be first field: {}",
            response
        );
        assert!(response.contains(r#""native_version":"0.7.0-test""#));
    }

    #[test]
    fn empty_payload_with_zero_since_ms_still_object() {
        let snap = snapshot(0, "", true);
        let response = format_liveness_response(&snap);
        assert!(response.contains(r#""last_state":{}"#));
        assert!(response.contains(r#""phase_override":null"#));
    }
}
