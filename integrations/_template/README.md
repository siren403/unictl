# integrations/_template/

This directory contains template versions of integration metadata files with explicit placeholder tokens.

## Placeholder tokens

| Token | Description |
|-------|-------------|
| `{{VERSION}}` | unictl release version (e.g. `0.4.0`) |
| `{{OWNER}}` | GitHub repository owner (e.g. `siren403`) |
| `{{REPO}}` | GitHub repository name (e.g. `unictl`) |

## Usage

Copy `plugin.config.json` or `support-pack.json` from this directory and replace all
`{{TOKEN}}` placeholders before use in a scaffold or fork.

Downstream scaffolders that previously relied on the `OWNER/REPO` placeholder pattern in
`integrations/codex/plugin.config.json` or `integrations/claude-code/support-pack.json`
should migrate to these template files. As of v0.4.0 the shipped integration metadata
is version-matched and uses the real `siren403/unictl` slug. See `DEPRECATION.md`.
