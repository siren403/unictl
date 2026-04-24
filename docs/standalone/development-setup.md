# unictl Development Setup

Contributor bootstrap guide for the `unictl` repository.

For end-user installation see [consumer-guide.md](consumer-guide.md).

---

## 1. Prerequisites

| Tool | Purpose |
|------|---------|
| Bun | TypeScript runtime + package manager |
| Rust + Cargo | Native bridge (`native/unictl_native/`) |
| Unity Editor | Integration testing against a real project |
| Git | Version control |

Supported platforms: Windows x64, macOS (Apple Silicon + Intel).

---

## 2. Repository structure

```
tools/unictl/
├── package.json                  ← workspace root (private, name: unictl-repo)
├── scripts/
│   ├── release.ts                ← canonical release driver
│   └── release/
│       └── assemble.ts           ← artifact assembly (integration zips, checksums)
├── packages/
│   ├── cli/                      ← npm package "unictl"
│   │   ├── package.json
│   │   ├── bin.js                ← npm bin shim → src/cli.ts
│   │   └── src/
│   └── upm/com.unictl.editor/    ← Unity UPM package
├── native/unictl_native/         ← Rust FFI native bridge
├── integrations/                 ← Codex / Claude Code adapter packs
└── docs/standalone/              ← this directory
```

---

## 3. Install dependencies

```bash
cd tools/unictl
bun install
```

---

## 4. Local CLI development

No build step required — Bun runs TypeScript natively.

```bash
# Run CLI directly from source
bun run packages/cli/src/cli.ts --help
bun run packages/cli/src/cli.ts version
bun run packages/cli/src/cli.ts doctor --project /abs/path/to/project
```

Or register a script alias in a consumer project's `package.json`:

```json
{
  "scripts": {
    "unictl": "bun run ../tools/unictl/packages/cli/src/cli.ts"
  }
}
```

### Packed tarball preflight

To test the npm-published surface before publishing:

```bash
cd packages/cli
bun pm pack --filename /tmp/unictl-preflight.tgz
bunx --package file:/tmp/unictl-preflight.tgz unictl --help
```

---

## 5. Native bridge

Rebuild after changing `native/unictl_native/`:

```bash
# Windows
bun run build:native:windows

# macOS
bun run build:native:macos
```

Prebuilt binaries are checked in to `packages/upm/com.unictl.editor/Plugins/` so most
contributors do not need to rebuild.

---

## 6. UPM local install

Test the Unity package against a local Unity project without publishing:

```json
{
  "dependencies": {
    "com.unictl.editor": "file:/abs/path/to/tools/unictl/packages/upm/com.unictl.editor"
  }
}
```

Verify: package registers, dependencies resolve, no compile errors in batchmode.

---

## 7. Release flow

The canonical release driver is `scripts/release.ts`. It handles version sync, artifact
assembly, and the full publish sequence. `scripts/release/assemble.ts` is called by
`release.ts` as a post-commit step and is not invoked standalone.

### Commands

```bash
bun run release              # patch bump (0.3.0 → 0.3.1) + full publish
bun run release minor        # 0.3.0 → 0.4.0
bun run release major        # 0.3.0 → 1.0.0
bun run release 0.4.0        # exact version
bun run release --no-publish # version sync + git only; skip npm publish
bun run release 0.4.0 --dry-run  # validation only; no push, no tag, no publish
```

### Release order (safe, no orphan tags)

1. Bump `package.json × 3` versions and commit locally: `release: v<ver>`
2. `npm publish` — public artifact first
3. `git push main` — source commit now public
4. `git tag v<ver>` — tag points to the published commit
5. `git push origin v<ver>`

**Why this order**: tagging after publish prevents orphan public tags that point at
unpublished source. See [release-process.md](release-process.md) for partial-release
recovery procedures.

### `--dry-run` vs `--no-publish`

| Flag | What it skips |
|------|--------------|
| `--no-publish` | `npm publish` only; commits, tags, and pushes proceed |
| `--dry-run` | Everything: no push, no tag, no publish; runs version sync + assembly + validation only |

`--dry-run` is used by the CI release rehearsal lane to validate the release path before merge.

### Artifact assembly

`assemble.ts` produces:

- `release-manifest.json`
- `SHA256SUMS`
- `codex-plugin-<ver>.zip`
- `claude-code-support-<ver>.zip`
- `com.unictl.editor-<ver>.tgz`

---

## 8. Type checking

Bun runs TypeScript natively — no separate compile step is needed in CI. Use IDE/LSP type
feedback during development. There is no `tsc --noEmit` lane in CI by design.

---

## 9. Error registry validation

After touching error kinds in `packages/cli/src/` or UPM `Editor/` C# files, run:

```bash
bun run check:error-registry
```

This verifies that every `errorExit(...)` / `BuildError(...)` kind exists in
`packages/cli/src/error-registry.json` and has a corresponding `HintTable` entry.

---

## 10. Commit conventions

- Branch per feature/fix.
- One contract change per commit.
- Docs, code, and tests land in the same commit when they concern the same contract boundary.
- Follow the phase-labelled commit style used in the project history:
  `feat: ...`, `fix: ...`, `chore: ...`, `release: v<ver>`.
