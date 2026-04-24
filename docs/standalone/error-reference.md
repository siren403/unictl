<!-- Do not edit by hand; run `bun run gen:error-ref` to regenerate -->
# unictl Error Reference

This document is auto-generated from `packages/cli/src/error-registry.json`.

## Error Kinds

| Kind | Emitted From | Exit Code | Hint |
|------|-------------|-----------|------|
| `invalid_param` | builtin_preflight | 2 | unictl command build_project  # show parameter usage |
| `target_unsupported` | builtin_preflight | 2 | unictl command list  # see allowed target enum for build_project |
| `editor_busy` | builtin_preflight | 3 | wait for compile/import, or run: unictl editor status |
| `project_locked` | cli, compile | 3 | stale UnityLockfile; remove it or run: unictl editor quit |
| `multi_instance` | cli | 3 | multiple editors detected; quit extras before building |
| `ipc_no_progress_file` | cli | 3 | IPC ack received but no progress file appeared in 3 s; check: unictl doctor |
| `timeout` | cli, compile | 124 | client wait timeout; build still running; poll: unictl command build_status -p job_id=<id> |
| `build_exception` | cli, build_runner | 1 | see <job_id>.log for Unity stack trace; re-run with --log-level=debug |
| `build_failed` | build_runner | 1 | see progress_file report_summary for error details; check Unity log |
| `editor_running` | cli, compile | 3 | editor is running; quit it first or omit --batch to use IPC lane |
| `editor_not_running` | cli | 3 | editor is not running; open it first with: unictl editor open |
| `cancelled_by_user` | build_runner | 1 | Job aborted by user via build_cancel. Re-run the build if needed. |
| `not_cancellable` | build_runner | 3 | Job is past queue stage. BuildPipeline.BuildPlayer has no interrupt API; wait for completion. |
| `profile_switch_requires_batch` | builtin_preflight | 3 | IPC lane cannot cross a domain reload. Quit editor and re-run with --batch to apply a BuildProfile. |
| `profile_not_found` | cli | 2 | BuildProfile asset not found at the given path. Verify path relative to project root. |
| `profile_invalid_extension` | cli | 2 | BuildProfile path must end with .asset. Pass an asset path, not a directory or label. |
| `profile_invalid_path` | cli | 2 | BuildProfile path must resolve inside the project root. |
| `profile_unsupported_on_this_unity` | cli, builtin_preflight | 2 | BuildProfile requires Unity 6000.0+. Remove --build-profile or upgrade editor. |
| `profile_not_applied` | build_runner | 3 | BuildProfile CLI flag was not applied. Check Unity console for profile load errors; verify the asset is valid and path is correct. |
| `ipc_error` | cli, doctor | 3 | IPC call failed; check: unictl doctor |
| `unity_not_found` | cli, doctor | 3 | Unity binary not found. Verify Unity Hub installation and project version. |
| `project_not_detected` | doctor | 2 | Run unictl commands from within a Unity project directory, or pass --project <path>. |
| `compile_failed` | compile | 1 | Unity compile errors found. Check errors[] in output for details. |
| `job_not_found` | build_runner | 3 | No progress file for that job_id. Verify the id returned by build_project, or the job may have been pruned (retention policy keeps last 10). |
| `progress_read_failed` | build_runner | 125 | Progress file exists but could not be read/parsed after retries. Transient AV/Dropbox lock or file corruption. Retry in a few seconds. |
| `not_yet_implemented` | build_runner | 125 | this capability is scaffolded in P1; wire-up lands with later phases |

## Exit Code Summary

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Build/operation failed (build_failed, build_exception, compile_failed, cancelled_by_user) |
| 2 | Param/validation error (invalid inputs, unsupported profile, path errors) |
| 3 | Lane/resource unavailable (editor busy, project locked, IPC errors) |
| 124 | Client wait timeout (build still running) |
| 125 | unictl internal error |
