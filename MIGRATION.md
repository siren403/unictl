# Migration Guide

## 0.6.x → 0.7.0

### Summary

v0.7.0 introduces a verb-noun command tree alongside the existing
`unictl command <tool>` dispatcher. Every v0.6 invocation that worked
before still works the same way and emits the same exit codes. The new
surface is layered on top with structured error envelopes, canonical
agent metadata via `--describe`, and a wait engine for editor-state
synchronization.

The `unictl command` verb itself is **not** going away — it remains the
canonical dispatcher for consumer-defined `[UnictlTool]` classes. v1.0
hard-removes only the *specific invocation patterns* that have a v0.7
verb-noun equivalent (see the table below). The dispatcher and any
custom `[UnictlTool]` registered in a consumer Unity project continue
to be invoked via `unictl command <tool>` indefinitely.

No breaking IPC protocol changes. Native ABI is additive-only after Phase A7.

### What's new at the call site

| Before (v0.6) | After (v0.7) |
|---------------|--------------|
| `unictl command editor_control -p action=play` | `unictl editor play` |
| `unictl command editor_control -p action=stop` | `unictl editor stop` |
| `unictl command editor_control -p action=compile` | `unictl editor compile` |
| `unictl command editor_control -p action=refresh` | `unictl editor refresh` |
| `unictl --help --json` (text→JSON) | `unictl <verb> --describe` (canonical metadata) |

> v0.7.0 / v0.7.1 of this guide listed `unictl command list` → `unictl
> describe-all` here. That mapping was **wrong** and was removed in
> v0.7.2. The two commands are not equivalent: `command list`
> enumerates every registered `[UnictlTool]` at runtime (builtin
> tools + consumer-defined tools), while `describe-all` returns
> static metadata for the v0.7 verb-noun tree only. Use both —
> they cover different surfaces.

The legacy forms continue to work and emit a one-line `[deprecated]`
stderr suggestion on the mappable cases. The mapping table above is
removed in v1.0 — i.e. `unictl command editor_control -p action=play`
will return an unknown-tool error then. The `unictl command` dispatcher
itself stays. See [DEPRECATION.md](DEPRECATION.md) for the full policy.

### Custom `[UnictlTool]` invocation (unchanged)

Consumer projects that register their own tools via the `[UnictlTool]`
attribute keep invoking them through `unictl command`:

```bash
# Consumer-defined tool — same call shape across v0.6 / v0.7 / v1.0+.
unictl command my_save_inspector -p target=Player
```

Builtin tools that have NO v0.7 verb-noun equivalent yet
(`capture_ui`, `editor_log`, `execute_menu`, `ping`, `ugui_input`,
`ui_toolkit_input`, `build_status`, `build_cancel`,
`editor_control -p action=load_scene`) also continue via
`unictl command <tool>` until/unless a future minor release adds
verb-noun hosts for them. They are NOT covered by the v1.0 removal.

### Output format change for v0.7 verbs

v0.7 verbs default to `--json` ON (machine-readable). v0.6 verbs keep
their previous default (human-readable) for backward compatibility.

To force human output:

- Per call: append `--no-json`.
- Per shell: `export UNICTL_HUMAN=1`.

### Error envelope shape

v0.7 verbs emit the new structured envelope:

```jsonc
{
  "ok": false,
  "error": {
    "code": 4098,            // numeric code per F.6 namespaces (NEW)
    "kind": "editor_not_running",
    "message": "...",
    "recovery": "...",       // NEW — concrete next action
    "related": ["editor.open", "wait"],  // NEW — sibling commands
    "context": { ... },      // NEW — structured payload for agents
    "hint_command": "unictl editor open",
    "hint_text": null,       // NEW — human prose hint
    "exit_code": 3
  }
}
```

v0.6 verbs continue to emit the previous envelope shape unchanged. The
human-readable `kind` slug remains the canonical branch key — agents
should branch on `kind`, not on `code`. The `code` field is a stable
identifier for telemetry and cross-version correlation.

### `--describe` (canonical agent metadata)

Every v0.7 verb supports `--describe`:

```bash
unictl editor compile --describe
# → DescribeMetadata JSON: schema_version, name, verb, noun, summary,
#   when, when_not, args, examples, exit_codes, related, since_version,
#   stability. Exits 0 without running the command.

unictl describe-all
# → { schema_version: 1, commands: [...] } — aggregate over all v0.7 verbs.
```

`unictl --help --json` continues to work but is deprecated. Migrate to
`--describe` ahead of v1.0.

### Wait integration

Synchronous "dispatch then block until state X" replaces sleep+retry
loops:

```bash
# In-editor compile, block until it settles to idle (default 120s)
unictl editor compile --wait idle --timeout 90s

# Enter Play mode, wait until live (default 15s)
unictl editor play --wait

# Standalone wait
unictl wait reachable --timeout 30s
```

Default timeouts come from the F.3 matrix (see
`docs/standalone/v0.7-spikes/F3-wait-timeouts.md`). Override with
`--timeout` or `UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB>_<STATE>` env vars.
SIGINT during a wait exits 130 with `kind: interrupted`.

### Settings lifecycle bundles (editor-closed)

`unictl input set`, `unictl scripting set`, `unictl deploy android
keystore set`, and `unictl settings raw-set` mutate `ProjectSettings.asset`
directly. They require the editor to be closed (Unity caches in-memory
PlayerSettings and would overwrite the change otherwise).

```bash
# Switch Input System (closes editor first via --restart)
unictl input set new --restart

# IL2CPP for Android (editor must be closed already)
unictl scripting set il2cpp --platform android

# Configure keystore path/alias (passwords supplied at build time)
unictl deploy android keystore set --path Build/release.keystore --alias release

# Escape hatch — accept the no-warranty contract
unictl settings raw-set companyName Tinycell --no-warranty
```

`deploy android keystore set` does NOT persist passwords. Supply them at
build time via the standard Unity env vars `UNITY_ANDROID_KEYSTORE_PASS`
and `UNITY_ANDROID_KEYALIAS_PASS`, or via `-keystorePass`/`-keyaliasPass`
batchmode arguments.

### Native + UPM compatibility

- The native bridge gained `unictl_heartbeat` and `unictl_get_liveness`
  exports. Existing exports unchanged. ABI is additive-only after the
  Phase A7 freeze.
- The UPM package gained `UnictlHeartbeat.cs` and `UnictlRuntimeJson.cs`
  ([InitializeOnLoad] members). Existing code unchanged. After upgrading
  the UPM package, restart the editor once so it picks up the new sources;
  `Library/unictl/runtime.json` will appear once the editor reaches the
  ready state.
- A `runtime.json` schema bump (currently 1) follows the
  schema-version-above-supported gate; CLI returns
  `kind: schema_unsupported` on a future bump rather than parsing
  unknown fields.

### Recommended migration steps

1. Update the UPM package reference to the v0.7.0 tag and restart the
   editor. Confirm `Library/unictl/runtime.json` appears.
2. Bump the CLI: `bunx unictl@0.7.0 doctor`.
3. Replace any `unictl command editor_control -p action=...` call sites
   with the equivalent verb (see table above).
4. If you parse `--help --json` output, migrate to `--describe` /
   `unictl describe-all`.
5. If you have sleep+retry loops around editor state, replace with
   `unictl wait <state> --timeout T` or the per-verb `--wait` flag.
6. If you run CI scripts that toggle Input System / scripting backend /
   keystore in batch, prefer the new feature bundles over hand-editing
   YAML.

### What does NOT change

- IPC protocol (named pipe + JSON request/response).
- Build / test / compile / doctor / capabilities / health / version
  command surfaces.
- Error kinds emitted by v0.6 verbs.
- Project layout — no new required directories or files in consumer
  projects.

---

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
