use std::collections::HashMap;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Mutex;
use std::thread;

use tiny_http::{ConfigListenAddr, Method, Response, Server, ServerConfig};

static COUNTER: AtomicI32 = AtomicI32::new(0);
static STARTED: AtomicBool = AtomicBool::new(false);

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

// --- HTTP 서버 (Unix socket) ---

#[unsafe(no_mangle)]
pub extern "C" fn unictl_start(sock_path: *const c_char) -> i32 {
    if STARTED.load(Ordering::SeqCst) {
        return 0;
    }

    let path = unsafe { CStr::from_ptr(sock_path) }
        .to_str()
        .unwrap_or("")
        .to_owned();
    if path.is_empty() { return -1; }

    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::remove_file(&path);

    let server = match Server::new(ServerConfig {
        addr: ConfigListenAddr::unix_from_path(&path),
        ssl: None,
    }) {
        Ok(s) => s,
        Err(_) => return -2,
    };

    *ASYNC_RESPONSES.lock().unwrap() = Some(HashMap::new());
    STARTED.store(true, Ordering::SeqCst);

    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let url = request.url().to_owned();
            let method = request.method().clone();

            if url == "/health" {
                let has_handler = HANDLER.lock().unwrap().is_some();
                let body = format!(r#"{{"status":"ok","handler_registered":{}}}"#, has_handler);
                let _ = request.respond(Response::from_string(&body).with_header(
                    "Content-Type: application/json".parse::<tiny_http::Header>().unwrap(),
                ));
                continue;
            }

            thread::spawn(move || {
                let body = match (method, url.as_str()) {
                    (Method::Post, "/command") => {
                        let mut body = String::new();
                        request.as_reader().read_to_string(&mut body).unwrap_or(0);
                        handle_command(&body)
                    }
                    _ => format!(r#"{{"error":"not_found","path":"{}"}}"#, url),
                };
                let _ = request.respond(Response::from_string(&body).with_header(
                    "Content-Type: application/json".parse::<tiny_http::Header>().unwrap(),
                ));
            });
        }
    });

    0
}

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
    // 이 배리어 없이는 wake_via_http → C# → unictl_pop_main 순서가
    // 메모리 순서상 push보다 먼저 관측될 수 있어 명령이 유실됨.
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
    // 응답 수신(또는 timeout) 후 wake 스레드를 종료
    wake_done.store(true, Ordering::Relaxed);
    result
}

/// C# HttpListener에 HTTP 요청을 보내 Unity main loop을 깨운다.
/// HttpListener의 IO completion이 main thread를 활성화.
/// wake_done이 true가 되면 루프를 종료 — 호출측에서 응답 수신 후 set.
fn wake_via_http(wake_done: std::sync::Arc<AtomicBool>) {
    let port = INTERNAL_PORT.load(Ordering::SeqCst);
    if port <= 0 { return; }

    // 백그라운드에서 지속적으로 wake — main loop이 command 처리할 때까지
    thread::spawn(move || {
        while !wake_done.load(Ordering::Relaxed) {
            use std::io::Write;
            if let Ok(mut s) = std::net::TcpStream::connect(("127.0.0.1", port as u16)) {
                let _ = s.write_all(b"GET /wake HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
                let _ = s.flush();
                // 응답 읽기 (연결 완료 대기)
                let mut buf = [0u8; 64];
                let _ = std::io::Read::read(&mut s, &mut buf);
            }
            thread::sleep(std::time::Duration::from_millis(50));
        }
        // wake_done == true: 응답 수신 또는 timeout 후 호출측에서 set
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
