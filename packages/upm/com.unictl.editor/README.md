# com.unictl.editor

Unity Editor companion package for [unictl](https://github.com/siren403/unictl).

## Install

Add to `Packages/manifest.json`:

```json
{
  "dependencies": {
    "com.unictl.editor": "https://github.com/siren403/unictl.git?path=/packages/upm/com.unictl.editor#v0.3.0"
  }
}
```

Open the Unity Editor after adding the dependency. The package compiles automatically and the IPC server starts with the editor.

## What it does

Runs an IPC server inside the Unity Editor — a named pipe on Windows, a Unix socket on macOS — that the `unictl` CLI connects to for build, compile, editor lifecycle, and UI inspection operations.

The endpoint name is derived from a SHA256 hash of the project root path, so no configuration files are required. Both the CLI and this package compute the same endpoint name from the same path.

## Requirements

- Unity 2022.3 LTS or later
- Unity 6000.0+ for `--build-profile` / BuildProfile features
- Windows x64 or macOS (Apple Silicon and Intel)
- Bun runtime on the operator machine (for the CLI side)

## Built-in commands

| Command | Description |
|---------|-------------|
| `build_project` | Trigger a player build (IPC or batchmode lane) |
| `build_status` | Poll async build job state |
| `build_cancel` | Cooperatively cancel a queued build |
| `capture_ui` | Screenshot any Unity UI window to file |
| `ui_toolkit_input` | Programmatic UI Toolkit click/type events |

## Docs

Full consumer guides and workflows are in the
[unictl repo docs](https://github.com/siren403/unictl/tree/main/docs/standalone).

## License

MIT
