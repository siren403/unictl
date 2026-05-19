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
| `editor_compile_error_state` | cli, editor_lane | 1 | Unity has C# compile errors, so editor-side unictl workflows may be unreliable until those errors are fixed. |
| `unictl_cli_too_old` | cli, editor_lane | 1 | The Unity UPM package is newer than the unictl CLI. Update the CLI before retrying editor-side workflows. |
| `unictl_cli_version_unknown` | editor_lane | 1 | The Unity UPM package could not see a CLI version. Update unictl CLI before retrying editor-side workflows. |
| `unictl_cli_version_invalid` | editor_lane | 1 | The Unity UPM package could not parse the CLI version. Update unictl CLI before retrying editor-side workflows. |
| `unictl_upm_too_old` | cli | 1 | The unictl CLI is newer than the Unity UPM package. Update com.unictl.editor in the Unity project. |
| `unictl_upm_version_unknown` | cli | 1 | The Unity UPM package did not report version metadata. Update com.unictl.editor before running editor-side workflows. |
| `unictl_version_invalid` | cli | 1 | The CLI and Unity UPM package versions could not be compared. Update both sides to matching releases. |
| `job_not_found` | build_runner | 3 | No progress file for that job_id. Verify the id returned by build_project, or the job may have been pruned (retention policy keeps last 10). |
| `progress_read_failed` | build_runner | 125 | Progress file exists but could not be read/parsed after retries. Transient AV/Dropbox lock or file corruption. Retry in a few seconds. |
| `not_yet_implemented` | build_runner | 125 | this capability is scaffolded in P1; wire-up lands with later phases |
| `editor_lane_unavailable` | cli, test | 2 | Editor lane is not yet available. Use --batch to run tests in headless batchmode. |
| `tests_failed` | test | 1 | One or more tests failed. Check the results XML for details. |
| `no_assemblies` | test | 3 | No tests found. Verify that test assemblies are configured for the target platform. |
| `xml_parse_failed` | test | 4 | Test results XML missing or unparseable. Check the Unity log for errors. |
| `unity_crash` | test | 5 | Unity crashed or exited abnormally during test run. Run doctor to verify installation. |
| `test_timeout` | test | 6 | Test run exceeded the wall-clock timeout. Increase --timeout or reduce test scope. |
| `test_invalid_filter` | test | 7 | Unity rejected the test filter expression. Check assembly name, namespace, or method spelling. |
| `unknown_test_failure` | test | 8 | Tests completed but Unity exited non-zero. Check the Unity log for unexpected errors. |
| `editor_busy_playing` | test, editor_lane | 2 | Editor is in Play mode. Stop Play mode before running tests. |
| `editor_busy_compiling` | test, editor_lane | 2 | Editor is compiling scripts. Wait for compilation to finish. |
| `editor_busy_updating` | test, editor_lane | 2 | Editor is importing assets. Wait for asset database refresh to finish. |
| `editor_dirty_scene` | test, editor_lane | 2 | One or more open scenes have unsaved changes. Save or pass --allow-unsaved-scenes. |
| `editor_dirty_prefab_stage` | test, editor_lane | 2 | Prefab stage has unsaved changes. Exit or save the prefab stage before running tests. |
| `editor_reload_active` | test, editor_lane | 2 | PlayMode tests with full domain reload are not supported in editor lane. Use --batch or enable DisableDomainReload in Enter Play Mode settings. |
| `results_path_unwritable` | test, editor_lane | 2 | Cannot write to the specified results path. Check directory permissions or specify a writable path. |
| `test_already_running` | test, editor_lane | 2 | Another test job is already running in the editor. Wait for it to complete before starting a new run. |
| `editor_died` | test, editor_lane | 8 | Editor process exited unexpectedly during test run. Check Unity crash logs. |
| `editor_session_changed` | test, editor_lane | 8 | Editor was restarted mid-run. The test job is no longer valid. Re-run the test. |
| `test_heartbeat_stale` | test, editor_lane | 8 | No progress update received for 5 seconds. Editor may be deadlocked or heavily throttled. |
| `xml_save_failed` | test, editor_lane | 8 | Test results XML could not be saved. Check that --results path is writable. |
| `deprecated_log_source` | editor_lane | 2 | The requested log source is deprecated. Use editor_log action=tail, search, or errors against the project-scoped editor log. |
| `editor_log_unavailable` | editor_lane | 1 | Project-scoped editor log is unavailable. Restart the editor through unictl so the current session writes Library/unictl-state/editor-current.log. |
| `editor_log_project_log_missing` | editor_lane | 1 | Project-scoped editor log is missing. The current editor was probably not started through unictl. |
| `editor_log_stale_session` | editor_lane | 1 | Project-scoped editor log predates the current Unity process, so returning it would expose stale diagnostics. |
| `not_implemented` | cli | 78 | This command is a Phase C skeleton stub; functional implementation arrives in Phase D or E. Track progress on issue siren403/unictl#7. |
| `editor_reload_active` | cli, editor_lane | 3 | Editor is reloading; retry after /liveness reports phase != reloading. CLI --wait handles this transparently in v0.7. |
| `wait_timeout` | cli | 124 | Wait budget exhausted before the target state was reached. Verify editor health with 'unictl health' or raise --timeout. F.3 matrix lives in docs/standalone/v0.7-spikes/F3-wait-timeouts.md. |
| `interrupted` | cli | 130 | SIGINT (Ctrl+C) was received during a wait. Re-run if the cancellation was unintentional. |
| `editor_unresponsive` | cli | 3 | Editor heartbeat is stale past the A4 reload ceiling. Check editor logs and consider 'unictl editor restart'. |
| `project_root_invalid` | cli | 2 | Could not resolve a Unity project root from --project or cwd. Pass --project <path-to-project-root>. |
| `setting_key_not_found` | cli | 2 | Top-level scalar key not found in ProjectSettings.asset. Inspect the file or use a feature bundle (input set / scripting set / deploy keystore set). |
| `confirmation_required` | cli | 2 | settings raw-set requires --no-warranty to acknowledge that raw edits bypass Unity setter side effects. Prefer feature bundles when one fits. |
| `keystore_path_not_found` | cli | 2 | Keystore file not found at the resolved --path. Verify the file exists. |
| `secret_required` | cli | 2 | Keystore and key passwords are required. Pass --keystore-pass / --key-pass or pipe via stdin. Passwords are never echoed or logged. |

## Exit Code Summary

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Build/operation failed (build_failed, build_exception, compile_failed, cancelled_by_user) |
| 2 | Param/validation error (invalid inputs, unsupported profile, path errors) |
| 3 | Lane/resource unavailable (editor busy, project locked, IPC errors) |
| 124 | Client wait timeout (build still running) |
| 125 | unictl internal error |
