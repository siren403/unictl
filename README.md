# unictl

`unictl` is a CLI + Unity UPM pair that gives agents and CI pipelines a programmable control surface over the Unity Editor — builds, compiles, editor lifecycle, and UI inspection — without menu-item hacks or process-level kills.

## Install

### CLI (npm)

```bash
# one-off / agent use
bunx unictl@latest --help

# permanent dev dependency
bun add -D unictl
```

### Unity UPM

Add to `Packages/manifest.json`:

```json
{
  "dependencies": {
    "com.unictl.editor": "https://github.com/siren403/unictl.git?path=/packages/upm/com.unictl.editor#v0.3.0"
  }
}
```

## Quick start

```bash
# 1. Confirm environment is healthy
bunx unictl@latest doctor --project /abs/path/to/project

# 2. Open (or confirm) the Unity Editor
unictl editor open --project /abs/path/to/project

# 3. List available built-in commands
unictl command list --project /abs/path/to/project

# 4. Trigger a build
unictl command build_project -p target=StandaloneWindows64 --project /abs/path/to/project

# 5. Poll for result
unictl command build_status -p job_id=<id> --project /abs/path/to/project
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Developer / Agent / CI                                          │
│                                                                  │
│   unictl build | compile | command | doctor | editor | health   │
└────────────────────────┬─────────────────────────────────────────┘
                         │
              Named Pipe (Windows)
              Unix Socket (macOS)
              [IPC — line-delimited JSON]
                         │
┌────────────────────────▼─────────────────────────────────────────┐
│  Unity Editor                                                    │
│                                                                  │
│   com.unictl.editor (UPM)                                        │
│   └─ UnictlServer  ──► CommandRouter                             │
│                         ├─ build_project → BuildPipeline         │
│                         ├─ build_status  → BuildRunner state     │
│                         ├─ build_cancel  → queue cancellation    │
│                         ├─ capture_ui    → ScreenCapture         │
│                         └─ ui_toolkit_input → UIToolkit events   │
└──────────────────────────────────────────────────────────────────┘
```

Endpoint naming: SHA256 of the project root path → deterministic pipe/socket name. No config files required.

## Features

- **build_project** — dual-lane routing: IPC when editor is running, batchmode when it is not
- **build_status** — async job polling with structured state + error fields
- **build_cancel** — cooperative queue-stage cancellation
- **BuildProfile support** — Unity 6000.0+ `--build-profile` flag (batchmode only)
- **unictl compile** — headless script compilation with exit code contract (0/1/3/124)
- **capture_ui** — screenshot any Unity UI window to file
- **ui_toolkit_input** — programmatic UI Toolkit click/type events
- **editor lifecycle** — `editor open | status | quit | restart`
- **doctor** — environment, UPM install, and IPC reachability checks

## Docs

- [Consumer guide](docs/standalone/consumer-guide.md)
- [Workflows](docs/standalone/WORKFLOWS.md)
- [Error reference](docs/standalone/error-reference.md)
- [Security model](docs/standalone/security-model.md)
- [Release process](docs/standalone/release-process.md)
- [Roadmap](docs/standalone/ROADMAP.md)
- [Development setup](docs/standalone/development-setup.md)

## Support

Issues: https://github.com/siren403/unictl/issues
Changelog: [CHANGELOG.md](CHANGELOG.md)
Migration: [MIGRATION.md](MIGRATION.md)
License: MIT
