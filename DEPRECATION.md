# Deprecation Notices

## Integration pack metadata placeholder tokens (deprecated as of v0.4.0)

As of v0.4.0, integration pack metadata ships version-matched to the unictl release.
Previously these were templated with `OWNER/REPO` placeholders.

Downstream scaffolders relying on placeholder tokens should migrate to
`integrations/_template/` (if present) or pin to a pre-v0.4.0 tag.

Files affected:
- `integrations/codex/plugin.config.json`
- `integrations/claude-code/support-pack.json`

Template equivalents with explicit `{{OWNER}}`, `{{REPO}}`, and `{{VERSION}}` tokens
are available at `integrations/_template/`.
