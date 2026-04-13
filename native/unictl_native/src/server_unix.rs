/// macOS: tiny_http over Unix domain socket (existing logic, extracted).

use std::thread;
use tiny_http::{ConfigListenAddr, Method, Response, Server, ServerConfig};

use crate::protocol::route_request;

pub fn start(path: &str) -> i32 {
    // Prepare socket directory and clean up stale socket file
    if let Some(parent) = std::path::Path::new(path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::remove_file(path);

    let server = match Server::new(ServerConfig {
        addr: ConfigListenAddr::unix_from_path(path),
        ssl: None,
    }) {
        Ok(s) => s,
        Err(_) => return -2,
    };

    thread::spawn(move || {
        for mut request in server.incoming_requests() {
            let url = request.url().to_owned();
            let method = request.method().clone();

            // Health check — handle inline (fast path)
            if url == "/health" {
                let body = route_request("GET", "/health", "");
                let _ = request.respond(Response::from_string(&body).with_header(
                    "Content-Type: application/json".parse::<tiny_http::Header>().unwrap(),
                ));
                continue;
            }

            // All other requests — handle in a dedicated thread
            thread::spawn(move || {
                let (method_str, req_body) = match method {
                    Method::Post => {
                        let mut body = String::new();
                        request.as_reader().read_to_string(&mut body).unwrap_or(0);
                        ("POST", body)
                    }
                    _ => ("GET", String::new()),
                };
                let resp = route_request(method_str, &url, &req_body);
                let _ = request.respond(Response::from_string(&resp).with_header(
                    "Content-Type: application/json".parse::<tiny_http::Header>().unwrap(),
                ));
            });
        }
    });

    0
}
