/// Windows: Named Pipe server with line-based JSON protocol.

use std::thread;

use windows::core::HSTRING;
use windows::Win32::Storage::FileSystem::{
    FlushFileBuffers, ReadFile, WriteFile, PIPE_ACCESS_DUPLEX,
};
use windows::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, DisconnectNamedPipe,
    PIPE_READMODE_BYTE, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES,
    PIPE_WAIT,
};
use windows::Win32::Foundation::{CloseHandle, HANDLE, INVALID_HANDLE_VALUE};

use crate::protocol::route_request;
use crate::SHUTDOWN;

const BUFFER_SIZE: u32 = 8192;

pub fn start(pipe_name: &str) -> i32 {
    let pipe_name = pipe_name.to_owned();

    thread::spawn(move || {
        // Run 4 listener threads for concurrent connections
        for _ in 0..4 {
            let name = pipe_name.clone();
            thread::spawn(move || pipe_instance_loop(&name));
        }
    });

    0
}

fn pipe_instance_loop(pipe_name: &str) {
    let wide_name = HSTRING::from(pipe_name);

    loop {
        if SHUTDOWN.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }

        // Create a new pipe instance
        let handle = unsafe {
            CreateNamedPipeW(
                &wide_name,
                PIPE_ACCESS_DUPLEX,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT,
                PIPE_UNLIMITED_INSTANCES,
                BUFFER_SIZE,
                BUFFER_SIZE,
                0,
                None,
            )
        };

        if handle == INVALID_HANDLE_VALUE {
            thread::sleep(std::time::Duration::from_millis(100));
            continue;
        }

        // Wait for a client to connect
        let connected = unsafe { ConnectNamedPipe(handle, None) };
        if connected.is_err() {
            // Client may have connected between CreateNamedPipe and ConnectNamedPipe
            // ERROR_PIPE_CONNECTED is OK, other errors mean we should retry
            let err = unsafe { windows::Win32::Foundation::GetLastError() };
            if err != windows::Win32::Foundation::ERROR_PIPE_CONNECTED {
                let _ = unsafe { CloseHandle(handle) };
                continue;
            }
        }

        // Handle the connection
        handle_pipe_client(handle);

        // Disconnect and close for reuse
        unsafe {
            let _ = DisconnectNamedPipe(handle);
            let _ = CloseHandle(handle);
        }
    }
}

fn handle_pipe_client(handle: HANDLE) {
    let mut read_buf = vec![0u8; BUFFER_SIZE as usize];
    let mut line_buf = String::new();

    loop {
        // Read data from pipe
        let mut bytes_read = 0u32;
        let ok = unsafe {
            ReadFile(
                handle,
                Some(&mut read_buf),
                Some(&mut bytes_read),
                None,
            )
        };

        if ok.is_err() || bytes_read == 0 {
            break; // Client disconnected or error
        }

        // Append to line buffer
        let chunk = String::from_utf8_lossy(&read_buf[..bytes_read as usize]);
        line_buf.push_str(&chunk);

        // Process complete lines
        while let Some(newline_pos) = line_buf.find('\n') {
            let line = line_buf[..newline_pos].trim().to_owned();
            line_buf = line_buf[newline_pos + 1..].to_owned();

            if line.is_empty() {
                continue;
            }

            let response = process_json_line(&line);
            let response_line = format!("{}\n", response);

            let resp_bytes = response_line.as_bytes();
            let mut bytes_written = 0u32;
            let _ = unsafe {
                WriteFile(
                    handle,
                    Some(resp_bytes),
                    Some(&mut bytes_written),
                    None,
                )
            };
            let _ = unsafe { FlushFileBuffers(handle) };
        }
    }
}

/// Parse a JSON-line request and route it.
/// Format: {"method":"GET|POST","path":"/health|/command","body":{...}}
fn process_json_line(line: &str) -> String {
    let method = extract_json_string(line, "method").unwrap_or_default();
    let path = extract_json_string(line, "path").unwrap_or_default();

    // Extract body as raw JSON substring
    let body = extract_json_object(line, "body").unwrap_or_default();

    let result = route_request(&method, &path, &body);
    format!(r#"{{"status":200,"body":{}}}"#, result)
}

/// Extract a string value from JSON by field name (simple parser).
fn extract_json_string(json: &str, field: &str) -> Option<String> {
    let needle = format!("\"{}\"", field);
    let start = json.find(&needle)?;
    let rest = &json[start + needle.len()..];
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('"')?;
    let end = rest.find('"')?;
    Some(rest[..end].to_owned())
}

/// Extract an object value from JSON by field name (simple brace-matching parser).
fn extract_json_object(json: &str, field: &str) -> Option<String> {
    let needle = format!("\"{}\"", field);
    let start = json.find(&needle)?;
    let rest = &json[start + needle.len()..];
    let rest = rest.trim_start();
    let rest = rest.strip_prefix(':')?;
    let rest = rest.trim_start();

    if rest.starts_with('{') {
        let mut depth = 0;
        let mut in_string = false;
        let mut escape = false;
        for (i, ch) in rest.char_indices() {
            if escape {
                escape = false;
                continue;
            }
            match ch {
                '\\' if in_string => escape = true,
                '"' => in_string = !in_string,
                '{' if !in_string => depth += 1,
                '}' if !in_string => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(rest[..=i].to_owned());
                    }
                }
                _ => {}
            }
        }
        None
    } else {
        // Not an object — return empty
        None
    }
}
