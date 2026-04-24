# Migration Guide

## 0.3.0 → 0.4.0

### Summary

v0.4.0 is a release hygiene and tooling milestone. No CLI command surface or IPC protocol
changes land in this release. The changes below affect downstream consumers of integration
metadata, release automation, and anyone relying on the previous release script order or
error taxonomy exit codes from `doctor`/`compile`.

---

### Integration metadata: templated placeholders replaced with version-matched values

**What changed**: `integrations/codex/plugin.config.json` and
`integrations/claude-code/support-pack.json` previously contained `OWNER/REPO` placeholder
strings and a static `0.1.0` version. As of v0.4.0 these files ship version-matched to
the unictl release and use the real repository slug `siren403/unictl`.

**Who is affected**: downstream scaffolders or CI pipelines that read these files and
relied on the `OWNER/REPO` token for substitution.

**Migration**: Use `integrations/_template/plugin.config.json` and
`integrations/_template/support-pack.json`, which carry explicit `{{OWNER}}`, `{{REPO}}`,
and `{{VERSION}}` tokens. Copy and substitute before use. Pin to a pre-v0.4.0 tag if
immediate migration is not possible.

See also: [DEPRECATION.md](DEPRECATION.md).

---

### Release path changed

**What changed**: `scripts/release.ts` is now the single canonical release driver.
The step order changed to eliminate orphan-tag risk:

- Old order: commit → tag → push → npm publish
- New order: commit (local) → npm publish → git push main → git tag → git push tag

`scripts/lib/release.ts` remains as a shared utility (referenced by `assemble.ts`,
`drift-check.ts`, and `fanout.ts`). It is not the release driver.

**Who is affected**: anyone automating release via the old script order or relying on
`scripts/lib/release.ts` as the entry point.

**Migration**: Use `bun run release <version>` from `tools/unictl/`. See
[docs/standalone/release-process.md](docs/standalone/release-process.md) for the full
step table and partial-release recovery procedures.

**New `--dry-run` flag**: runs version sync + artifact assembly + CHANGELOG validation
without pushing, tagging, or publishing. Used by the E2 release rehearsal CI lane.

---

### Old documentation references

Older documentation and integration examples may reference:

| Old reference | Current equivalent |
|---------------|-------------------|
| `list` (top-level command) | `unictl command list` |
| `editor_control` | `unictl editor` subcommand |
| `OWNER/REPO` in metadata | `siren403/unictl` in shipped files; `{{OWNER}}/{{REPO}}` in `integrations/_template/` |
| TCP + token transport | Named-pipe IPC (Windows) / Unix socket (macOS). No TCP. |
| `endpoint.json` | Not used. Pipe name is derived from project root path SHA256. |

---

### Error taxonomy: typed kinds coming in W2 D3 (breaking for exit-code consumers)

v0.4.0 introduces the groundwork for typed error kinds on `doctor` and `compile` commands.
The full typed kind rollout lands in Week 2 (D3 phase).

**Current state (v0.4.0)**: `doctor` exits 1 on blocking checks (no typed kind emitted).
`compile` exits 1 on compile errors, 3 on project lock, 124 on timeout.

**Breaking change (W2 D3)**: consumers relying on exit code 1 for all `doctor` failures
will need to handle additional exit codes:
- exit 2: `project_not_detected` or parameter validation error
- exit 3: `unity_not_found` or IPC unavailable

Pin to v0.4.0 or check `error.kind` instead of exit code if you need stability across
this change.

---

### Brief-window concession (npm publish before git push)

During release, there is a brief window (typically under 30 seconds) between npm publish
and git push where the published tarball's source commit is not yet visible on public
GitHub.

Consumers reproducing builds from source within this window should retry after 1 minute.

See [docs/standalone/release-process.md](docs/standalone/release-process.md) for the
full release order and recovery table.
