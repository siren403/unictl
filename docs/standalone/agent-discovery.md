# Agent Discovery Contract

This document defines the discovery surfaces that agents and CI scripts use to
find `unictl` commands. Keep it in sync with `AGENTS.md`.

## Discovery Surfaces

Agents should prefer these surfaces in this order:

1. `unictl --help` to find the machine-readable contract entrypoint.
2. `unictl schema` for an offline snapshot of all v0.7 command contracts.
3. `unictl schema <command>` for a single command contract, e.g.
   `unictl schema editor.open`.
4. `unictl capabilities` for cold-start top-level and builtin-tool discovery.
5. `unictl <command> --help --json` for compatibility with older agent flows.
6. `unictl command list` only when a live editor is available and runtime
   `[UnictlTool]` registrations are needed.

Human `--help` output is a router, not the contract. Agents must not parse help
text for flags, risks, or exit codes. If a command exists for users, it must be
visible through `unictl schema`.

First-class commands must be preferred over raw builtin tool dispatch whenever
both exist. Raw `unictl command <tool>` is an escape hatch for runtime
`[UnictlTool]` registrations and builtins without a verb-noun command. It must
not be the richer path for common agent workflows:

- Prefer `unictl editor status` over `unictl command editor_control -p action=status`.
- Prefer `unictl wait <state>` over ad-hoc `editor_control` polling.
- Prefer `unictl test` over raw `unictl command test_run`.
- Prefer `unictl command editor_log -p action=tail|search|errors` over
  deprecated `game_logs`. Project-scoped `editor_log` is reliable only when the
  editor session was started through `unictl editor open` or `unictl editor
  restart`; otherwise it returns structured failure details such as
  `requires_editor_restart=true` instead of silently reading stale data.
- Use `unictl command editor_log -p action=tail --format text` only when a
  shell pipeline needs raw log lines. Keep the default JSON output for
  structured automation.
- If a raw async job is exposed, provide a first-class wait/status companion
  before documenting progress-file parsing as an agent workflow.

Legacy aliases remain for one compatibility window:

- `unictl describe-all` prints a deprecation warning and delegates to
  `unictl schema`.
- `unictl <command> --describe` prints a deprecation warning and delegates to
  `unictl schema <command>`.

## Required Sync Points

When adding, removing, renaming, or changing flags on a CLI command, update all
relevant locations in the same change:

- `packages/cli/src/cli.ts` command registration and `--help --json` routing.
- `packages/cli/src/schema.ts` for every v0.7 command contract.
- `packages/cli/src/capabilities.json` for cold-start discovery.
- `packages/cli/src/help-json.ts` if the command path is nested.
- `scripts/check-error-registry.ts` if a new command path must be guarded.
- User-facing docs under `docs/standalone/` when the workflow changes.

For nested commands, verify the full command path. Examples:

- `editor.compile` maps to `unictl editor compile`.
- `deploy.android.keystore.set` maps to `unictl deploy android keystore set`.
- `settings.raw-set` maps to `unictl settings raw-set`.

## Required Checks

Run these before closing a change that touches command shape, flags, errors, or
agent-facing metadata:

```powershell
mise run check:error-registry
mise run unictl -- --help
mise run unictl -- schema
mise run unictl -- schema editor.open
mise run unictl -- schema input.set
mise run unictl -- capabilities

# Compatibility aliases while they remain supported:
mise run unictl -- --help --json
mise run unictl -- describe-all
mise run unictl -- editor compile --help --json
mise run unictl -- deploy android keystore set --help --json
```

For broader changes, run:

```powershell
mise run check
```

## Regression Pattern

The most common failure is implementing a command but leaving one discovery
surface stale. For example, `unictl editor compile --wait` can work in the CLI
while agents miss it if `schema.ts`, `capabilities.json`, or `--help --json` still describes
only the parent `editor` command.

Treat this as a release-blocking regression. Agents should not need to infer
hidden commands from source code or human help text.
