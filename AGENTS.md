# AGENTS.md

This repository uses `AGENTS.md` as the canonical shared instruction file for agent tools.

## Project

- Project name: `unictl`
- Purpose: Unity Editor control CLI plus Unity UPM editor package for agent and CI automation.
- This is a multi-component repository, not just a CLI package.

## Repository Layout

```text
tools/unictl/
├── package.json                         # private repo workspace
├── packages/
│   ├── cli/                             # npm package: unictl
│   └── upm/com.unictl.editor/           # Unity UPM package
├── native/unictl_native/                # Rust native bridge
├── integrations/                        # Codex / Claude Code adapter packs
├── docs/standalone/                     # user-facing docs
├── scripts/                             # release and validation scripts
└── sandbox/                             # local Unity consumer smoke projects
```

## Runtime And Tasks

- Prefer project-scoped `mise` commands over relying on global runtime state.
- Use `mise install` after cloning or after runtime changes.
- Use `mise tasks ls` to discover local tasks.
- Preferred task entry points:
  - `mise run check`
  - `mise run check:error-registry`
  - `mise run check:meta-guids`
  - `mise run release:dry-run -- 0.6.4`
  - `mise run unictl -- <args>`
- Keep `package.json` scripts working for npm/Bun users, but agent workflows should use mise tasks when available.

## Release Model

| Component | Channel | Consumer usage |
|-----------|---------|----------------|
| CLI | npm registry package `unictl` | `bunx unictl@<version>` |
| Unity UPM | Git URL pinned to tag | `...?path=/packages/upm/com.unictl.editor#v<version>` |
| Native bridge | checked into UPM package plugins | loaded by Unity |

Rules:

- All versioned metadata is synchronized by `scripts/release.ts`.
- Do not manually edit release version fields unless deliberately debugging the release script.
- Keep `[Unreleased]` in `CHANGELOG.md` populated before release.
- Run `mise run release:dry-run -- <version>` before any real publish.
- Real release command is `mise run release -- <version>` and performs version commit, npm publish, git push, tag, and tag push.

## Validation

Default validation before committing meaningful changes:

```powershell
mise run check
```

For narrower changes:

- CLI/error registry/capabilities: `mise run check:error-registry`
- Unity UPM package files or `.meta` changes: `mise run check:meta-guids`
- Release path: `mise run release:dry-run -- <version>`

## Unity UPM `.meta` Rules

- Never hand-write placeholder Unity GUIDs.
- Do not use patterned GUIDs such as `a1b2...`, `c3d4...`, `0000...`, `1111...`, or sequential sample values.
- If an agent creates a `.meta` file without Unity, it must generate a random 32-character lowercase hex GUID.
- Duplicate or low-entropy-looking GUIDs in `packages/upm/com.unictl.editor` are release blockers.
- `scripts/check-unity-meta-guids.ts` is the mechanical guard for this rule and is run by release validation.

## Sandbox Projects

- `sandbox/UnictlSmokeProject` is a local Unity consumer project for Git UPM install, package resolve, and compile smoke tests.
- Track only project source, `Packages/`, and `ProjectSettings/`.
- Do not track Unity-generated local state such as `Library/`, `Temp/`, `Logs/`, `UserSettings/`, build outputs, `.sln`, or `.csproj`.
- Use the sandbox first when reproducing consumer install issues.

## Common Pitfalls

- Avoid `bunx github:repo` for release validation; Bun caches git refs aggressively. Prefer npm versions such as `bunx unictl@0.6.3`.
- Do not add a `dist/` build output. Bun runs TypeScript directly.
- Root `package.json` is private repo tooling; `packages/cli/package.json` is the npm-published package.
- `npm publish` may warn that `bin.js` is invalid and removed. This has been observed as an npm warning while the tarball still contains `bin.js`; verify with pack/tarball inspection if needed.
- `unictl init` only edits `Packages/manifest.json`. Unity resolves/imports the package on Package Manager refresh, editor restart, or batch compile.

## Task Hygiene

- Start with `git status --short --branch`.
- Keep release commits, validation/tooling commits, and consumer-project experiments separate.
- Do not revert unrelated dirty files from a parent Unity checkout.
- When testing against external projects such as `D:/workspace/unity/SceneFlow`, treat their dirty worktree as owned by that project/session unless explicitly asked to change it.
