/// Shared request/response types and routing logic.
/// Used by both server_unix (HTTP) and server_windows (Named Pipe).

use crate::{handle_command, HANDLER};

/// Route a request by method + path and return the JSON response body.
pub fn route_request(method: &str, path: &str, body: &str) -> String {
    match (method, path) {
        ("GET", "/health") => {
            let has_handler = HANDLER.lock().unwrap().is_some();
            format!(r#"{{"status":"ok","handler_registered":{}}}"#, has_handler)
        }
        ("POST", "/command") => handle_command(body),
        _ => format!(r#"{{"error":"not_found","path":"{}"}}"#, path),
    }
}
