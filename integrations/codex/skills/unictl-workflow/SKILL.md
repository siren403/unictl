# unictl workflow

Use this skill when you need to connect Codex to a Unity project through `unictl`, verify installation, or drive editor lifecycle commands before editing.

## Workflow

1. Run `unictl version` and `unictl doctor` for the target project first.
2. If the editor is not reachable, use `unictl editor status` and then `unictl editor open` when needed.
3. Prefer `unictl command <tool>` for built-in tool access.
4. Keep project-specific automations in the consumer repo; do not treat them as core `unictl` behavior.

## Guardrails

- `init` should be checked with `--dry-run` before writing.
- `doctor` failure is blocking until manifest, endpoint, or editor state is understood.
- Shared install and workflow docs live under `docs/standalone/`.
