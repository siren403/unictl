# unictl Release Process

This document describes the canonical release procedure for unictl, the rationale for
the step order, and recovery procedures for partial-release failures.

## Prerequisites

- npm automation token configured (interactive 2FA breaks the release script).
- `CHANGELOG.md` has a populated `[Unreleased]` section with at least one bullet entry.
- Working tree is clean (`git status` shows no uncommitted changes).

## The 5-Step Release Order

Run from `tools/unictl/`:

```bash
bun run release <version>
# examples:
bun run release 0.4.0
bun run release minor
bun run release patch
```

The script executes these steps in order:

| Step | Action | Skipped by |
|------|--------|-----------|
| 1 | Version sync: bump `version` in all `package.json` files and integration metadata | — |
| 2 | Validate `CHANGELOG.md`: abort if `[Unreleased]` section is missing or empty | — |
| 3 | Assemble integration artifacts (`assemble.ts`): build Codex/Claude zips + checksums | — |
| 4 | `git commit "release: v<ver>"` (local only) | — |
| 5 | `npm publish packages/cli --access public` | `--no-publish`, `--dry-run` |
| 6 | `git push origin main` | `--dry-run` |
| 7 | `git tag v<ver>` | `--dry-run` |
| 8 | `git push origin v<ver>` | `--dry-run` |

### Rationale for this order

npm publish happens **before** `git push` and **before** `git tag`. This eliminates the
"orphan tag" risk: if publish fails, no public artifact exists, no tag has been created,
and re-running the script is safe (idempotency guard at the top checks whether
`package.json` is already at the target version with a matching commit).

If publish succeeds but a subsequent git step fails, the artifact is public but the
source commit is not yet visible on GitHub. This is a narrow window (see below) with
documented manual recovery steps.

## Flags

| Flag | Behavior |
|------|----------|
| _(none)_ | Full release: version sync + assemble + commit + publish + push + tag |
| `--no-publish` | Skips `npm publish` only; still does commit, push, tag |
| `--dry-run` | Skips `git push`, `git tag`, `git push tag`, AND `npm publish`; runs version sync + assemble + validation only; exits 0 on success |

`--no-publish` and `--dry-run` are mutually exclusive.

### Dry-run usage (release rehearsal)

```bash
bun run release 0.4.0 --dry-run
# After test, revert version bumps:
git checkout -- package.json packages/cli/package.json packages/upm/com.unictl.editor/package.json integrations/codex/plugin.config.json integrations/claude-code/support-pack.json
```

## Partial-Release Recovery

| Failure point | State after failure | Recovery |
|---------------|--------------------|---------:|
| **Step 3 fails** (assemble) | No commit, no publish. Version files bumped locally. | Fix assemble issue, then re-run `bun run release <version>`. The idempotency guard detects no release commit yet and proceeds. |
| **Step 5 fails** (npm publish) | Local commit exists, no public artifact. | Re-run `bun run release <version>`. The idempotency guard exits early if already committed; run `npm publish --access public` in `packages/cli/` directly, then continue from step 6 manually. |
| **Step 6 fails** (git push main) | npm artifact is public, source commit not yet on GitHub. | Manual: `git push origin main`. The published tarball's source commit will become visible once the push succeeds. |
| **Steps 7-8 fail** (tag / push tag) | Published, commit pushed, but no git tag. | Manual: `git tag v<ver> HEAD && git push origin v<ver>`. |

## Brief-Window Concession

Between step 5 (npm publish) and step 6 (git push main), the published tarball's source
commit is not yet visible on public GitHub. This window is typically under 30 seconds.

Consumers reproducing builds from source within this window should retry after 1 minute.

This is an accepted trade-off: the alternative (tag before publish) creates orphan public
tags on publish failure, which is harder to recover cleanly.

## Idempotency Guard

At startup, the release script checks whether `package.json` is already at the target
version AND a `release: v<ver>` commit already exists in the local log. If both are true,
the script exits 0 with "Nothing to do." This makes re-running safe after partial failures.

## CHANGELOG Enforcement

The script aborts with a clear error if:
- `CHANGELOG.md` does not exist.
- `CHANGELOG.md` has no `## [Unreleased]` section.
- The `[Unreleased]` section has no bullet entries.

Always populate the `[Unreleased]` section before running a release.
