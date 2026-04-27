# unictl test — Test Runner Reference

Run Unity tests in headless batchmode without opening the editor.

> **Editor lane status**: The `--batch` flag is currently required. Editor lane (interactive, live-editor IPC) is planned for **v0.6.0**.

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
| `--batch` | **Yes** | Run in headless batchmode. Omitting this flag exits with `editor_lane_unavailable` (exit 2). |
| `--platform` | **Yes** | Test platform: `editmode` or `playmode`. |
| `--results` | **Yes** | Output path for the NUnit XML results file. Parent directory is created automatically. |
| `--filter` | No | Unity `-testFilter` expression. See filter syntax below. |
| `--timeout` | No | Wall-clock timeout in seconds. `0` or omitted = unlimited. Unity is killed and `test_timeout` is returned when exceeded. |
| `--editor-version` | No | Override the Unity editor version to use. Default: read from `ProjectSettings/ProjectVersion.txt`. |
| `--project` | No | Unity project root path. Auto-detected from current directory if omitted. |

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

- `--batch` is required. The editor lane (running tests via IPC against a live editor) is planned for **v0.6.0**.
- Play Mode tests require a valid player build configuration; failures during player build emit `unity_crash` or `unknown_test_failure`.
- `unictl test` does not start the Unity editor; it is purely headless. Do not have the editor open on the same project when running tests.
- NUnit XML parsing uses attribute extraction from the `<test-run>` element; nested test detail is not surfaced in the JSON output (read the XML directly for per-test breakdown).
