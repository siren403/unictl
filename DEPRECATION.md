# Deprecation Notices

## `unictl command <tool>` (deprecated as of v0.7.0, removed in v1.0)

The legacy generic-tool dispatcher is superseded by the v0.7 verb-noun
tree. Every v0.6 invocation continues to work in v0.7 and emits a
one-line `[deprecated]` stderr suggestion when a v0.7 equivalent exists.

| Legacy invocation | v0.7 equivalent |
|-------------------|------------------|
| `unictl command editor_control -p action=play` | `unictl editor play` |
| `unictl command editor_control -p action=stop` | `unictl editor stop` |
| `unictl command editor_control -p action=compile` | `unictl editor compile` |
| `unictl command editor_control -p action=refresh` | `unictl editor refresh` |
| `unictl command list` | `unictl describe-all` |

Custom `[UnictlTool]` C# tools that are NOT mapped above continue to be
invokable via `unictl command <tool> -p ...`. They will need a
verb-noun host once v1.0 removes the legacy dispatcher.

Migration: see [MIGRATION.md](MIGRATION.md#06x--070).

---

## `unictl <subcmd> --help --json` (deprecated as of v0.7.0, removed in v1.0)

The text-help-as-JSON discoverability path is superseded by the
canonical `--describe` flag and `unictl describe-all` aggregator.

| Legacy invocation | v0.7 equivalent |
|-------------------|------------------|
| `unictl --help --json` | `unictl describe-all` |
| `unictl <verb> --help --json` | `unictl <verb> --describe` |

`--describe` returns a strict `DescribeMetadata` schema (schema_version,
name, verb, noun, summary, when, when_not, args, examples, exit_codes,
related, since_version, stability) — agents can branch on it
deterministically. `--help --json` is a best-effort serialization of
the citty help text and is not schema-stable.

Migration: see [MIGRATION.md](MIGRATION.md#06x--070).

---

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
