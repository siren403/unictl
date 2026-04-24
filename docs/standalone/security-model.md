# Security Model

_Applies to `unictl` v0.4.0+_

## Summary

`unictl` is a local development tool. The IPC endpoint between the CLI and the Unity Editor trusts any process running as the same local user. This is appropriate for single-user developer workstations and CI runners, but NOT for multi-user or exposed systems without additional isolation.

## Transport

| Platform | Transport | Authentication |
|----------|-----------|----------------|
| Windows  | Named Pipe (`\\.\pipe\unictl-<hash>`) | Default DACL (local user read/write) |
| macOS / Linux | Unix Domain Socket (`/tmp/unictl-<hash>.sock`) | Filesystem permissions (0600 user-only) |

Endpoint names are derived from a SHA256 hash of the project root path, so different projects get different endpoints without collision.

**No cryptographic authentication** is performed beyond OS-level access control.

## Trust Model

`unictl` assumes:

- Only the local user has access to the pipe/socket.
- The user running `unictl` CLI is the same user running the Unity Editor.
- No malicious process is running as the same user.

If these assumptions hold, the IPC endpoint cannot be impersonated or intercepted.

## Threat Boundaries

### In scope

- **Local single-user workstation** (developer laptop, macOS/Windows) — supported, default trust model suffices.
- **CI runner (single job per VM)** — supported; the runner user owns both CLI and Unity Editor.

### Out of scope

- **Multi-user systems** (shared terminal servers, Jumpbox, etc.) — the default Windows DACL permits all users on the machine. Use explicit DACL hardening if needed; unictl does not ship this.
- **Cross-machine access** — unictl has no network protocol. All IPC is local.
- **Untrusted processes running as the same user** — e.g., browser-delivered malware running in user-mode. Defense is out of scope; unictl inherits the OS trust level.

## Known Limitations

1. **Windows default DACL** (`native/unictl_native/src/server_windows.rs:45-53`): the named pipe is created with default security attributes (the `None` parameter to `CreateNamedPipeW`). On most workstation configurations this resolves to local-user-only, but on some Windows Server configurations the default may be more permissive. If this matters for your deployment, audit the resolved ACL via PowerShell's `Get-Acl` or `GetAccessControl()`.

2. **No pipe auth** — the first process to connect to the expected pipe name can exchange IPC messages. A malicious same-user process could preempt the Unity Editor if it wins a race.

3. **Build artifacts** — produced builds may contain sensitive defines or profile data. unictl does not sanitize build output; redact via `--define` parameters if needed.

## Hardening (deferred to v0.5.0+)

The following are explicitly out of scope for v0.4.0. Contributions welcome if external demand emerges:

- Per-session token authentication (mutual auth between CLI ↔ UPM server)
- Explicit DACL tightening on Windows named pipe creation
- TLS/mutual-TLS over local loopback (over-engineered for current use cases)
- Cross-machine relay (not a planned feature; would require major redesign)

## Reporting Security Concerns

File an issue at https://github.com/siren403/unictl/issues with the `security` label. For confidential reports, contact the maintainer listed in the repo profile.

## References

- [Windows Named Pipe Security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- [Unix Domain Socket Permissions](https://man7.org/linux/man-pages/man7/unix.7.html)
- `native/unictl_native/src/server_windows.rs` — Windows named pipe server implementation
- `native/unictl_native/src/server_unix.rs` — Unix socket server implementation
