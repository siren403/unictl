# Agent Discovery Contract

This document defines the discovery surfaces that agents and CI scripts use to
find `unictl` commands. Keep it in sync with `AGENTS.md`.

## Discovery Surfaces

Agents should prefer these surfaces in this order:

1. `unictl <command> --describe` for v0.7 verb-noun commands.
2. `unictl describe-all` for an offline snapshot of all v0.7 verb-noun commands.
3. `unictl capabilities` for cold-start top-level and builtin-tool discovery.
4. `unictl <command> --help --json` for compatibility with older agent flows.
5. `unictl command list` only when a live editor is available and runtime
   `[UnictlTool]` registrations are needed.

Human `--help` output is not enough. If a command exists for users, it must also
be visible through the structured discovery surfaces above.

## Required Sync Points

When adding, removing, renaming, or changing flags on a CLI command, update all
relevant locations in the same change:

- `packages/cli/src/cli.ts` command registration and `--help --json` routing.
- `packages/cli/src/describe.ts` for every v0.7 verb-noun command.
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
mise run unictl -- --help --json
mise run unictl -- describe-all
mise run unictl -- capabilities
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
while agents miss it if `capabilities.json` or `--help --json` still describes
only the parent `editor` command.

Treat this as a release-blocking regression. Agents should not need to infer
hidden commands from source code or human help text.
