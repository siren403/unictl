use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use std::thread;

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

// A2 stub: managed-side heartbeat sink. A3 will replace with a typed
// `LivenessState` parsed via `serde_json` plus a monotonic `Instant` of
// last receipt. For A2 we keep the most recently seen JSON payload as
// an opaque string so the wire shape can be exercised end-to-end without
// committing the receiver's struct layout. Per F.8: JSON-over-pipe only.
static LIVENESS: Mutex<Option<String>> = Mutex::new(None);

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
            // Domain Reload 중 — MAIN_QUEUE에 저장
            MAIN_QUEUE.lock().unwrap().push(body.to_owned());
            let id = extract_field(body, "id");
            format!(r#"{{"accepted":true,"id":"{}","deferred":true}}"#, id)
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

// --- A2 stub: heartbeat sink (managed → native) ---
//
// A2 stub: receives heartbeat from managed; A3 will implement actual storage,
// monotonic-Instant capture, and `/liveness` route serving.
// Per F.8: JSON-over-pipe only — `state_json` is null-terminated UTF-8.
// Per A1/A7: contract is additive-only; consumers must accept unknown fields.
// Returns 0 on success, non-zero reserved for A3 (e.g. -1 on parse failure).
#[unsafe(no_mangle)]
pub extern "C" fn unictl_heartbeat(timestamp_ms: i64, state_json: *const c_char) -> i32 {
    if state_json.is_null() {
        return -1;
    }
    let json = unsafe { CStr::from_ptr(state_json) }
        .to_str()
        .unwrap_or("")
        .to_owned();

    // Minimal A2 behavior: store last payload so a smoke test or future A3
    // wiring can observe it. Timestamp is intentionally ignored here; A3 will
    // capture `std::time::Instant::now()` at receipt instead (R16: monotonic).
    let _ = timestamp_ms;
    *LIVENESS.lock().unwrap() = Some(json);
    0
}
