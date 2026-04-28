# unictl test — Test Runner Reference

Run Unity tests via the editor lane (IPC, v0.6.0+) or headless batchmode (`--batch`).

> **v0.6.0+**: `--batch` is no longer required when the editor is running. See [Editor Lane (v0.6.0+)](#editor-lane-v060) below.

---

## Usage

```
unictl test --batch \
  --platform <editmode|playmode> \
  --results <output.xml> \
  [--filter <expression>] \
  [--timeout <seconds>] \
  [--editor-version <version>] \
  [--project <path>]
```

### Flags

| Flag | Required | Description |
|------|----------|-------------|
| `--batch` | No (batchmode) | Force headless batchmode. Without this flag, unictl auto-routes to editor lane if the editor is running; returns `editor_not_running` (exit 9) if not. |
| `--platform` | **Yes** | Test platform: `editmode` or `playmode`. |
| `--results` | **Yes** | Output path for the NUnit XML results file. Parent directory is created automatically. |
| `--filter` | No | Unity `-testFilter` expression. See filter syntax below. |
| `--timeout` | No | Wall-clock timeout in seconds. `0` or omitted = unlimited. Unity is killed and `test_timeout` is returned when exceeded. |
| `--editor-version` | No | Override the Unity editor version to use. Default: read from `ProjectSettings/ProjectVersion.txt`. |
| `--project` | No | Unity project root path. Auto-detected from current directory if omitted. |
| `--allow-unsaved-scenes` | No | (Editor lane only) Bypass dirty-scene preflight for PlayMode. |
| `--allow-reload-active` | No | (Editor lane only) Force PlayMode + Full Reload. Dangerous — may hang indefinitely. |

---

## Filter Syntax

Unity's `-testFilter` accepts three forms:

| Form | Example | Matches |
|------|---------|---------|
| Assembly | `assembly:MyTests` | All tests in the `MyTests` assembly |
| Namespace / Class | `MyGame.Tests.PlayerTests` | All methods in that class |
| Specific method | `MyGame.Tests.PlayerTests.SpawnTest` | Single test method |

Multiple filters can be combined with commas:
```
unictl test --batch --platform editmode \
  --filter "assembly:MyTests,assembly:IntegrationTests" \
  --results out.xml
```

---

## Exit Codes

unictl **does not trust the Unity native exit code directly**. Instead it combines:

- Unity process exit code
- stderr / log file pattern matching (`Crash`, `Invalid test filter`)
- NUnit XML existence and parseability
- `<test-run>` attribute values (`total`, `passed`, `failed`, `errors`)

The remapping table:

| Exit Code | Error Kind | Decision Basis |
|-----------|-----------|----------------|
| 0 | success | XML parsed + `failCount=0` + `errorCount=0` |
| 1 | `tests_failed` | XML parsed + `failed>0` or `errors>0` |
| 2 | `editor_lane_unavailable` | `--batch` flag was not passed |
| 3 | `no_assemblies` | XML parsed + `total=0` |
| 4 | `xml_parse_failed` | Unity exited but XML missing or unparseable |
| 5 | `unity_crash` | stderr contains `Crash` pattern or abnormal process exit |
| 6 | `test_timeout` | Wall-clock `--timeout` exceeded; process was killed |
| 7 | `test_invalid_filter` | stderr / log contains `Invalid test filter` |
| 8 | `unknown_test_failure` | None of the above matched; conservative fallback |

---

## Output Format

### Success

```json
{
  "ok": true,
  "platform": "editmode",
  "total": 5,
  "passed": 5,
  "failed": 0,
  "skipped": 0,
  "results_file": "/abs/path/to/out.xml",
  "log_file": "/abs/path/to/Library/unictl-tests/test-<ts>.log",
  "duration_ms": 3200
}
```

### Failure

```json
{
  "ok": false,
  "error": {
    "kind": "tests_failed",
    "message": "2 test(s) failed (failed=2, errors=0)",
    "hint": "unictl test --batch --platform editmode --results out.xml",
    "hint_command": "unictl test --batch --platform <platform> --results <output.xml>"
  }
}
```

The error JSON is written to **stderr**. stdout receives only success payloads.

---

## Examples

### Run all Edit Mode tests

```bash
unictl test --batch --platform editmode --results TestResults/results.xml
```

### Run Play Mode tests with a 5-minute timeout

```bash
unictl test --batch --platform playmode \
  --results TestResults/playmode.xml \
  --timeout 300
```

### Run a specific assembly

```bash
unictl test --batch --platform editmode \
  --filter "assembly:MyProject.Tests" \
  --results TestResults/unit.xml
```

### Run a specific test class

```bash
unictl test --batch --platform editmode \
  --filter "MyProject.Tests.InventoryTests" \
  --results TestResults/inventory.xml
```

### Run from a different project directory

```bash
unictl test --batch --platform editmode \
  --project /path/to/UnityProject \
  --results /tmp/results.xml
```

---

## Log Files

Unity batch output is written to `Library/unictl-tests/test-<timestamp>.log` inside the project root. The absolute path is included in the `log_file` field of the success JSON output.

---

## Known Limitations

### Batchmode (`--batch`)

- Play Mode tests require a valid player build configuration; failures during player build emit `unity_crash` or `unknown_test_failure`.
- Do not have the editor open on the same project when running batchmode tests.
- NUnit XML parsing uses attribute extraction from the `<test-run>` element; nested test detail is not surfaced in the JSON output (read the XML directly for per-test breakdown).

### Editor Lane

See [Known Limitations (Editor Lane)](#known-limitations-editor-lane) below.

---

## Editor Lane (v0.6.0+)

When the Unity editor is running on the target project, `unictl test` automatically uses the editor lane — no `--batch` flag needed.

```
unictl test --platform <editmode|playmode> --results <path>
```

If the editor is not running, unictl returns `editor_not_running` (exit 9) and suggests using `--batch`.

### How It Works

1. CLI sends `test_run` IPC call to the live editor → editor responds immediately with `{ok: true, job_id, state: "queued"}`.
2. CLI polls `Library/unictl-tests/<job-id>.json` for progress (250 ms initial, up to 2 s backoff).
3. Heartbeat staleness is detected at 5 s; if the editor PID dies or the session ID changes, the CLI exits with the appropriate error kind.

### New Flags

| Flag | Description |
|------|-------------|
| `--allow-unsaved-scenes` | PlayMode + dirty scene: bypass the `editor_dirty_scene` preflight rejection. |
| `--allow-reload-active` | PlayMode + Full Reload (Domain Reload ON): force the attempt. Dangerous — may hang indefinitely. |

### Preflight Rejections (PlayMode)

The editor evaluates these conditions before accepting a `test_run` job. Any rejection returns immediately with no test started.

| Error Kind | Condition |
|------------|-----------|
| `editor_busy_compiling` | Editor is compiling scripts. |
| `editor_busy_updating` | Editor is refreshing the AssetDatabase. |
| `editor_busy_playing` | Editor is already in PlayMode. |
| `editor_dirty_scene` | Open scene has unsaved changes (use `--allow-unsaved-scenes` to bypass). |
| `editor_dirty_prefab_stage` | Prefab stage is open with unsaved changes. |
| `editor_reload_active` | Domain Reload is enabled (`Reload Domain` = ON). Use `--allow-reload-active` to force, or switch to `DisableDomainReload`. |
| `results_path_unwritable` | The specified `--results` path is not writable. |
| `test_already_running` | A `test_run` job is already active in this editor session. |

### Lane Comparison

| Item | Batchmode (`--batch`) | Editor Lane (default) |
|------|-----------------------|----------------------|
| Startup cost | Slow (new Unity process) | Fast (IPC, no new process) |
| PlayMode + Full Reload | Supported | Rejected (`editor_reload_active`) |
| Affects user's editor session | No | Yes (PlayMode entry disrupts editing) |
| CI environments | Recommended | Not recommended |
| Requires running editor | No | Yes |

### Known Limitations (Editor Lane)

1. **PlayMode + Full Reload not supported.** `Reload Domain` = ON causes Unity to reload all assemblies during PlayMode entry, which interrupts the IPC connection. Switch to `DisableDomainReload` or use `--batch`.
2. **PlayMode batchmode triggers a player build** (10+ minutes). Editor lane is the only fast path for PlayMode.
3. **No concurrent test/build lock.** Running `unictl build` and `unictl test` (editor lane) simultaneously may corrupt editor state.
4. **Multi-project concurrency not supported.** A single editor session handles one `test_run` job at a time.
5. **`reload_during_run` is not a distinct exit.** Mid-run domain reloads surface as `test_heartbeat_stale` or `editor_session_changed` depending on timing.
6. **`--allow-reload-active=true` is advisory only.** unictl marks the attempt as user-acknowledged but cannot prevent a hang.
7. **Run In Background caveat.** When the editor's `Run In Background` preference is off, the editor update tick slows to near-zero when the window is unfocused, causing apparent heartbeat stalls that are not real crashes.
