# Phase C Final Notes — describe / errors / mapping sub-PRs

Closes the v0.7 verb-noun tree (Phase C) by landing the three remaining sub-PRs
in one bundle: `C-describe`, `C-errors`, and `C-mapping`. Builds on
`C-skeleton-notes.md`, which delivered C3 (verb-noun skeleton) + C7 (--json
default + UNICTL_HUMAN policy).

## Scope

| Sub-PR     | Surface area                                              |
|------------|-----------------------------------------------------------|
| C-describe | `--describe` flag on every v0.7 verb + `unictl describe-all` aggregator + `DescribeMetadata` schema in `describe.ts` |
| C-errors   | Numeric error code allocations (F.6 stride 0x1000) + `errorEnvelope` v0.7 envelope + new `not_implemented` / `editor_reload_active` registry entries |
| C-mapping  | v0.6 → v0.7 deprecation suggestions on `unictl command editor_control -p action=…` and `unictl command list` |

## Files Touched

| File | Change |
|------|--------|
| `packages/cli/src/describe.ts` | NEW. `DescribeMetadata` schema + `v07Describes` registry covering 9 verbs (`editor.compile|play|stop|refresh`, `input.set`, `deploy.android.keystore.set`, `scripting.set`, `settings.raw-set`, `wait`). |
| `packages/cli/src/code-allocations.json` | NEW. Numeric code map for 48 kinds, namespaces per F.6: special 0x0001-0x000F, validation 0x0010-0x001F, editor 0x1000, build 0x2000, test 0x3000, profile 0x4000, ipc 0x5000 (heartbeat 0x5010-0x5012, reload 0x5020), project 0x6000, input/scripting/settings 0x7000, deploy 0x8000. |
| `packages/cli/src/error.ts` | Added `lookupCode(kind)` and `errorEnvelope({kind, message, recovery, related, context, …})` for the v0.7 structured envelope. Legacy `errorExit()` and `lookupHintCommand()` preserved for v0.6 callers. |
| `packages/cli/src/error-registry.json` | Added `not_implemented` (exit 78) and `editor_reload_active` (exit 3) kinds with `since_version: "0.7.0"`. |
| `packages/cli/src/v07-commands.ts` | Wired `--describe` short-circuit (`maybeEmitDescribe`) and switched stub/IPC error paths to `errorEnvelope`. |
| `packages/cli/src/cli.ts` | Registered `describe-all` top-level command; added `suggestV07Mapping()` writing one-line stderr deprecation hints when `unictl command` is invoked with a v0.7-mappable verb. |
| `packages/upm/com.unictl.editor/Editor/Unictl/Internal/HintTable.cs` | Added editor-side hint strings for `not_implemented` and `editor_reload_active` so `mise run check:error-registry` drift checks pass. |

## Behavioral Contracts

### `--describe`

- Per critic 4.0: `--describe` is the canonical agent metadata channel for v0.7;
  `--help --json` is preserved as a deprecated alias and removed in v1.0.
- Each verb's `run()` calls `maybeEmitDescribe(name, args, flags)` before doing
  any IPC. When `args.describe === true`, the registered `DescribeMetadata`
  emits as JSON and the process exits 0.
- `unictl describe-all` aggregates every entry into one JSON document with
  `{schema_version: 1, commands: [...]}`.
- Schema fields: `schema_version`, `name`, `verb`, `noun`, `summary`, `when`,
  `when_not` (must be non-empty per A1), `args`, `examples`, `exit_codes`,
  `related`, `since_version`, `stability`.

### `errorEnvelope` (v0.7)

```jsonc
{
  "ok": false,
  "error": {
    "code": <numeric>,            // from code-allocations.json
    "kind": "not_implemented",
    "message": "...",
    "recovery": "Concrete next step",
    "related": ["editor.compile"],
    "context": { "planned_phase": "D", "verb": "wait" },
    "hint_command": "unictl command list",  // from error-registry.json
    "hint_text": null
  }
}
```

- `lookupCode(kind)` returns 0 for unknown kinds — caller should treat that
  as a registration gap.
- v0.7 callers append their own `exit_code` field after the envelope when
  they need a non-default exit (e.g. `78` for `not_implemented`, `125` for
  `ipc_error`). `exitCodeFor()` in `output.ts` reads it.

### v0.6 → v0.7 deprecation hints (C-mapping)

- `commandCmd.run()` calls `suggestV07Mapping(toolName, params)` after
  resolving params; if a mapping exists it writes
  `[deprecated] 'unictl command <tool>' has a v0.7 equivalent: <suggestion>`
  to `stderr` and continues with the original IPC call (no behavior change).
- Mappings: `editor_control` action=`play|stop|compile|refresh` → `unictl
  editor <action>`; `list` → `unictl describe-all`.
- Hard removal of `unictl command` is scheduled for v1.0 per the v0.7 plan.

## Verification

- `mise run check` (drift check + meta-guid scan) passes.
- Smoke tests:
  - `unictl --help` shows new `describe-all` subcommand alongside v0.7 verbs.
  - `unictl editor compile --describe` emits canonical metadata JSON, exits 0.
  - `unictl wait idle` returns the v0.7 envelope (`code: 4107`, `kind:
    not_implemented`, `exit_code: 78`).
  - `unictl describe-all` returns `{schema_version: 1, commands: [...]}`.
  - `unictl command editor_control -p action=play` writes the deprecation
    hint to stderr before failing on missing project (expected without a
    real editor).

## What Phase C Does NOT Cover

- Functional bodies for `wait`, `input.set`, `deploy.*`, `scripting.set`,
  `settings.raw-set`. Those land in Phases D (wait) and E (settings/lifecycle).
- Removal of `unictl command` and `--help --json`. Those happen in v1.0 per
  the deprecation policy.
- `--help --json` → `--describe` migration tooling for downstream consumers.
  Current `help-json.ts` continues to work; consumers should switch to
  `--describe` ahead of v1.0.

## Issue Tracking

Phase C closure on issue siren403/unictl#7. Phase D entry point: implementing
`unictl wait` against the live `runtime.json` reader from Phase B5.
