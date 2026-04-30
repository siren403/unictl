# unictl Consumer Guide

End-to-end guide for integrating `unictl` into a Unity project.

For contributor / developer setup see [development-setup.md](development-setup.md).

---

## 1. Prerequisites

| Requirement | Notes |
|-------------|-------|
| Unity 2022.3 LTS or later | Unity 6000.0+ required for `--build-profile` |
| Bun runtime | CLI is distributed as a Bun-native TypeScript package |
| Git | UPM dependency uses a git URL |
| Windows or macOS | Linux Editor not yet supported |

---

## 2. Install the UPM package

Add `com.unictl.editor` to `Packages/manifest.json` in your Unity project:

```json
{
  "dependencies": {
    "com.unictl.editor": "https://github.com/siren403/unictl.git?path=/packages/upm/com.unictl.editor#v0.3.0"
  }
}
```

Pin to a release tag. Unity resolves the git URL on next editor open and compiles the package automatically — no extra setup needed.

To update later, change the tag in `manifest.json` and let Unity re-resolve.

You can also let the CLI write the manifest entry:

```bash
bunx unictl@latest init --project /abs/path/to/project
```

`init` only edits `Packages/manifest.json`; it does not guarantee that an already-open Unity
Editor will immediately resolve or import the new package. Use it this way:

| Editor state | Recommended follow-up |
|--------------|----------------------|
| Closed | Run `unictl compile --project /abs/path/to/project` to force package resolve and script compile, or open the editor normally. |
| Open and package not installed yet | Use Unity Package Manager refresh/re-resolve, or restart the editor. `unictl` IPC commands are not available until the package imports and compiles. |
| Open and package already installed | Use `unictl doctor` / `unictl health` to confirm the IPC endpoint before running editor-lane commands. |

---

## 3. Install the CLI

```bash
# One-off (no install):
bunx unictl@latest --help

# Permanent dev dependency (recommended for agent/CI repos):
bun add -D unictl
```

Keep CLI and UPM package versions in sync. `v0.3.0` CLI + `#v0.3.0` UPM tag is the current stable pair.

---

## 4. First run

```bash
# Confirm environment: Unity found, UPM package installed, IPC reachable
unictl doctor --project /abs/path/to/project

# Open the editor (if not already running)
unictl editor open --project /abs/path/to/project

# List available built-in commands
unictl command list --project /abs/path/to/project
```

`doctor` checks:
- Unity Editor binary found on PATH / hub
- `com.unictl.editor` present in `Packages/manifest.json`
- IPC endpoint reachable (only when editor is running)

---

## 5. Build flows

### 5.1 Default (automatic lane selection)

```bash
unictl command build_project -p target=StandaloneWindows64 --project /abs/path/to/project
```

`unictl` selects the lane automatically:

| Editor state | Lane used |
|--------------|-----------|
| Running | IPC — fast, preserves editor state |
| Not running | Batchmode — starts Unity headless |

### 5.2 Force a specific lane

```bash
# Always use IPC (editor must be running)
unictl command build_project -p target=StandaloneWindows64 --force-ipc --project /abs/path/to/project

# Always use batchmode (CI, scripted pipelines)
unictl command build_project -p target=StandaloneWindows64 --batch --project /abs/path/to/project
```

### 5.3 BuildProfile (Unity 6+)

`BuildProfile` assets require batchmode and Unity 6000.0+:

```bash
unictl command build_project \
  --build-profile Assets/Settings/Profiles/Release.asset \
  --batch \
  --project /abs/path/to/project
```

`--build-profile` is incompatible with `--force-ipc`. Batchmode is mandatory because the
BuildProfile pipeline resolves outside of editor play-state.

---

## 6. Status polling and cancellation

`build_project` returns a `job_id`. Poll `build_status` until the job reaches a terminal state:

```bash
unictl command build_status -p job_id=<id> --project /abs/path/to/project
```

Response fields: `state` (`queued` | `running` | `succeeded` | `failed` | `cancelled`),
`exit_code` (when terminal), `error` (when failed).

To cancel a queued job before it starts building:

```bash
unictl command build_cancel -p job_id=<id> --project /abs/path/to/project
```

> Cancellation is cooperative and only effective at the queue stage. A build already running
> inside `BuildPipeline.BuildPlayer` cannot be interrupted.

---

## 7. Headless compile

`unictl compile` runs Unity script compilation in batchmode without a full build:

```bash
unictl compile --project /abs/path/to/project
```

Exit code contract:

| Code | Meaning |
|------|---------|
| 0 | Compile succeeded |
| 1 | Compile failed |
| 3 | Unity not found or lane unavailable |
| 124 | `--wait` client timeout |

---

## 8. Error recovery

Every failed response includes a `hint` field:

```json
{
  "ok": false,
  "error": {
    "kind": "target_unsupported",
    "message": "Build target 'WebGL' requires the WebGL module.",
    "hint": "Install the WebGL build support module via Unity Hub and retry."
  }
}
```

Follow the `hint` first. For a full table of error kinds, exit codes, and hints see
[error-reference.md](error-reference.md).

Common first steps when something goes wrong:

```bash
unictl doctor --project /abs/path/to/project
unictl editor status --project /abs/path/to/project
unictl health --project /abs/path/to/project
```

---

## 9. CI integration

Recommended batchmode pattern for CI pipelines:

```bash
# Compile check (fast, no artifact)
unictl compile --project /abs/path/to/project
# Exit 0 = clean, 1 = errors, 3 = Unity missing

# Full build
unictl command build_project \
  -p target=StandaloneWindows64 \
  --batch \
  --project /abs/path/to/project

JOB_ID=$(unictl command build_project ... | jq -r '.job_id')

# Poll until terminal
while true; do
  STATUS=$(unictl command build_status -p job_id=$JOB_ID --project /abs/path/to/project | jq -r '.state')
  [ "$STATUS" = "succeeded" ] && break
  [ "$STATUS" = "failed" ] && exit 1
  [ "$STATUS" = "cancelled" ] && exit 1
  sleep 5
done
```

Exit code contract for CI:

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Build/compile failed |
| 2 | Parameter / validation error |
| 3 | Lane unavailable (Unity missing, IPC unreachable) |
| 124 | `--wait` client timeout |
| 125 | Internal unictl error |

---

## 10. IPC transport

| Platform | Transport | Protocol |
|----------|-----------|----------|
| Windows | Named Pipe | Line-delimited JSON |
| macOS | Unix Socket | Line-delimited JSON |

Endpoint naming is deterministic: SHA256 of the absolute project root path. No endpoint config
files are required — both CLI and UPM package compute the same name from the same path.

---

## 11. Agent integration packs

Codex and Claude Code integration packs are thin wrappers around these docs and the CLI.
See `integrations/codex/` and `integrations/claude-code/` in the repo for pack contents.

Project-specific rules and automation live in the consumer repository, not in the integration packs.
