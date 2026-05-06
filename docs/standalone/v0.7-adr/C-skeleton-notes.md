<!-- Phase C-skeleton implementation notes (2026-05-07) -->

# Phase C — Sub-PR 1: CLI Verb-Noun Skeleton + `--json` Policy

First of four Phase C sub-PRs (per critic 2.1 split). Adds the v0.7 verb-noun command surface alongside the existing v0.6 commands and centralizes `--json` / `UNICTL_HUMAN` output policy via a shared utility.

This sub-PR covers tasks **C3** (verb-noun tree skeleton) and **C7** (`--json` default policy). C-describe (C1+C4+C10) and C-errors (C2+C5+C6+C9) follow as separate sub-PRs.

## Files added

| Path | Purpose |
|------|---------|
| `tools/unictl/packages/cli/src/output.ts` | Shared `emit()` / `shouldEmitJson()` policy utility |
| `tools/unictl/packages/cli/src/v07-commands.ts` | All v0.7 verb-noun commands (functional or stubbed) |
| `tools/unictl/docs/standalone/v0.7-adr/C-skeleton-notes.md` | This document |

## Files modified

| Path | Change |
|------|--------|
| `tools/unictl/packages/cli/src/cli.ts` | Imports v07-commands, registers `editor.{compile,play,stop,refresh}` and top-level `input/deploy/scripting/settings/wait` |

v0.6 surface (`build`, `test`, `command`, `compile`, `editor.{status,quit,open,restart}`, `health`, `version`, `capabilities`, `doctor`, `init`) is unchanged in this sub-PR. Deprecation warnings + delegation arrive in C-mapping (C8) which consumes `F5-compat-map.json`.

## C3 — Verb-noun tree

### Editor sub-verbs (functional)

`unictl editor compile` / `play` / `stop` / `refresh` are functional via the existing `editor_control` IPC tool. They accept the new `--json` / `--no-json` / `--project` flags and route through `emit()`.

```
$ unictl editor play --no-json
... (currently fails because there's no editor running, but the dispatch path is correct)
```

In v0.6 these were reachable only via `unictl command editor_control -p action=play`. C-mapping (C8) will surface a deprecation warning on the v0.6 form pointing to the new verb.

### Stub commands

The following are skeleton stubs that emit a structured `not_implemented` envelope (kind: `not_implemented`, exit code 78):

| Command | Wires in |
|---------|----------|
| `unictl wait <state>` | Phase D |
| `unictl input set <handler>` | Phase E |
| `unictl deploy android keystore set` | Phase E |
| `unictl scripting set <backend> --platform <p>` | Phase E |
| `unictl settings raw-set <key> <value> --no-warranty` | Phase E |

Stub bodies emit the planned argument shape (so `--help` shows the eventual signature) but unconditionally return:

```json
{
  "ok": false,
  "error": {
    "kind": "not_implemented",
    "message": "'<verb>' is a Phase C skeleton stub; functional implementation arrives in Phase <D|E>.",
    "recovery": "Track progress on issue siren403/unictl#7. Use 'unictl command ...' for now.",
    "hint_command": "unictl command list",
    "exit_code": 78
  }
}
```

Exit code `78` matches the EX_CONFIG convention from BSD sysexits — feature recognized but not yet usable. Phase C-errors (C6) finalizes the exit code matrix.

## C7 — `--json` policy

`output.ts` centralizes the policy:

```typescript
shouldEmitJson(kind: 'new' | 'legacy', flags) →
  flags.noJson === true       → false (force human)
  flags.json === true         → true  (force JSON)
  process.env.UNICTL_HUMAN==='1' → false (env override)
  kind === 'new'              → true  (default for v0.7)
  kind === 'legacy'           → false (default for v0.6 / preserved)
```

### Citty boolean negation

Citty parses `--no-<flag>` as the negation of `--<flag>` automatically — defining a single `json: { type: "boolean" }` arg gives both forms. Verified:

| Invocation | `args.json` |
|------------|-------------|
| (omitted) | `undefined` |
| `--json` | `true` |
| `--no-json` | `false` |

`readFlags` in `v07-commands.ts` maps these to `OutputFlags`:

```typescript
function readFlags(args) {
  if (args.json === true) return { json: true };
  if (args.json === false) return { noJson: true };
  return {};
}
```

### Verified behaviors

```
$ unictl wait foo                # default → JSON
{"ok":false,"error":{"kind":"not_implemented",...}}

$ unictl wait foo --no-json      # explicit human
error: not_implemented: 'wait' is a Phase C skeleton stub; ...
  recovery: Track progress on issue siren403/unictl#7. ...
  try: unictl command list

$ UNICTL_HUMAN=1 unictl wait foo # env override → human
error: not_implemented: ...

$ unictl wait foo --json         # explicit JSON (redundant for v0.7 default)
{"ok":false,"error":{...}}
```

### Legacy commands unchanged

v0.6 commands keep their existing UX. `--json` and `--no-json` flags only apply to commands using the shared `output.ts` utility. Adding the policy to v0.6 commands without changing their default would cause UX surprises (per critic 1.5 plan); legacy default-OFF is preserved.

## Acceptance criteria

- [x] Every documented v0.7 verb is reachable; `--help` works at every node.
- [x] `--json` default ON for new verbs; `--no-json` and `UNICTL_HUMAN=1` produce human output.
- [x] Legacy v0.6 surface unchanged.
- [x] `mise run check` (error-registry + meta-guids) passes — no new error registry entries needed in this sub-PR (numeric codes deferred to C9).

## Known limitations

- `not_implemented` kind is not registered in `error-registry.json`. C-errors (C5/C9) adds it to the registry with a numeric code from the `validation_*` namespace and updates `lookupHintCommand` accordingly.
- `--describe` is not yet wired (C-describe sub-PR adds it).
- The legacy `command editor_control -p action=*` path is not yet deprecation-warning-wrapped (C-mapping sub-PR adds it).

## Next sub-PRs

1. **C-describe** (C1+C4+C10) — `--describe` schema + plumbing per command + regenerated reference docs.
2. **C-errors** (C2+C5+C6+C9) — error envelope wiring + namespace allocation + exit code matrix + 46 kinds reconciliation.
3. **C-mapping** (C8) — F.5 compat-map consumed; deprecation warnings on v0.6 surface that has v0.7 equivalents.
