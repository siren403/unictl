# Phase E Implementation Notes — settings lifecycle bundles

Closes Phase E of the v0.7 plan in one bundled sub-PR: implements
`input set`, `scripting set`, `deploy android keystore set`, and
`settings raw-set` on top of a shared editor-closed YAML edit lane.

## Scope

| Verb | Status | YAML target |
|------|--------|-------------|
| `input set <legacy|new|both>` | functional | `activeInputHandler` (top-level scalar; `legacy=0`, `new=1`, `both=2`) |
| `scripting set <mono|il2cpp> --platform <P>` | functional | `scriptingBackend.<Platform>` (nested map; `mono=0`, `il2cpp=1`) |
| `deploy android keystore set --path --alias` | functional (path/alias only) | `AndroidKeystoreName`, `AndroidKeyaliasName`, `androidUseCustomKeystore=1` |
| `settings raw-set <key> <value> --no-warranty` | functional | Any top-level scalar (escape hatch) |

## Architecture

### `project-settings.ts` (NEW)

Line-oriented YAML editor for `ProjectSettings/ProjectSettings.asset`.

- **Why line-oriented, not a YAML round-trip**: Unity's serializer uses
  `%YAML 1.1` + `tag:unity3d.com` markers and a strict 2-space indent. A
  generic YAML round-trip would normalize whitespace, drop tags, or
  reorder keys — Unity's `SerializedObject` is sensitive to all of that.
  We only ever change one or two scalars per call, so replacing single
  lines preserves the file byte-for-byte everywhere else.

- `loadProjectSettings(projectRoot)` / `saveProjectSettings(projectRoot, content)` —
  read + atomic write (temp file + rename, F.2 pattern).

- `setTopLevelScalar(content, key, value)` — replaces `^  <key>: <value>$`
  at root indent. Throws `{kind: "setting_key_not_found"}` if the key is
  absent or maps to a nested object.

- `getTopLevelScalar(content, key)` — returns the existing value or `null`,
  used to surface the previous value in the response.

- `setNestedScalar(content, parent, child, value)` — replaces or inserts
  `    <child>: <value>` under a `^  <parent>:` mapping. Handles three
  states: parent is `parentKey: {}` (expanded then child appended),
  parent has existing children with the target key (replaced), parent
  has children without the target key (appended at block end).

- `resolvePlatformYamlKey(slug)` — maps CLI-friendly platform slugs
  (`android`, `ios`, `standalone`, `webgl`, `tvos`, console families)
  to Unity's case-sensitive YAML keys (`Android`, `iOS`, `Standalone`,
  ...). Returns `null` for unknown slugs (caller emits `target_unsupported`).

### `settings.ts` (NEW)

Cross-cutting glue:

- `requireEditorClosed({project, restart, intent})` — resolves project
  root via `findProjectRoot()` then reads `runtime.json`. If editor is
  alive, either fail with `editor_running` (exit 3) or, when `--restart`
  was passed, use the same quit lifecycle as `editor quit`, and re-check.
  Used by every Phase E command before any file write.

- `readSecretFromStdin(prompt)` — TTY-aware reader. On a TTY: raw mode +
  echo-suppressed line read. On a pipe: reads ALL stdin lines on first
  call, queues them, returns one per call so `printf "ksPass\nkeyPass\n"
  | unictl ...` works. Uses code-point comparison for control chars
  (`ETX/BS/DEL/LF/CR`) so the source doesn't carry literal control bytes.
  *(Currently unused in v0.7 — kept for future Phase F build credentials.)*

- `redact(value)` — fixed-width mask helper for logging, hides length.

### CLI bodies (`v07-commands.ts`)

Each command follows the same skeleton:

```
1. maybeEmitDescribe → exit 0 if --describe
2. validate inputs → invalid_param / target_unsupported (exit 2) on bad
3. await requireEditorClosed() → editor_running (exit 3) or project_root_invalid (exit 2)
4. load → mutate via project-settings helpers → saveProjectSettings
5. emit success envelope { ok: true, action, applied, project_root }
6. catch → kind-aware error envelope:
     setting_key_not_found → exit 2
     anything else        → exit 125 (ipc_error)
```

`settings raw-set` adds two preflight checks before step 3:

- `--no-warranty` is required (exit 2 `confirmation_required`). The flag
  is parsed via `rawArgs.includes("--no-warranty")` because citty/mri
  treats `--no-X` as boolean negation of a `X` arg, so a citty arg named
  `"no-warranty"` is invisible to the parser. This preserves the
  documented `--no-warranty` UX without renaming the flag.
- Dotted keys are rejected (exit 2 `invalid_param`) — nested edits go
  through feature bundles. Reserved for v1.x if needed.

## Keystore Password Policy (deliberate scope cut)

Unity does NOT persist keystore passwords to `ProjectSettings.asset`
under normal use. They live in the per-user EditorPrefs / Library state
and are excluded from source control. Earlier draft of `keystore set`
attempted to write `AndroidKeystorePass` / `AndroidKeyaliasPass` and
failed at runtime because the keys don't exist in stock ProjectSettings.

The v0.7 contract is:

- `deploy android keystore set` writes only the public fields
  (`AndroidKeystoreName`, `AndroidKeyaliasName`, `androidUseCustomKeystore=1`).
- Passwords are supplied at **build time** via Unity's standard CI env
  vars (`UNITY_ANDROID_KEYSTORE_PASS`, `UNITY_ANDROID_KEYALIAS_PASS`)
  or `-keystorePass`/`-keyaliasPass` batchmode arguments.
- `readSecretFromStdin` and `redact` ship in `settings.ts` for future
  Phase F build-credential work but are unused in v0.7.

This avoids leaking secrets into a tracked file and aligns with how
Unity Cloud Build, Codemagic, and GitHub Actions Unity actions already
expect signing material to flow.

## Files Touched

| File | Status |
|------|--------|
| `packages/cli/src/project-settings.ts` | NEW |
| `packages/cli/src/settings.ts` | NEW |
| `packages/cli/src/v07-commands.ts` | Replaced 4 stubs (input.set, deploy.android.keystore.set, scripting.set, settings.raw-set) |
| `packages/cli/src/describe.ts` | Updated 4 verb metadata (args, summary, examples, exit_codes, stability=beta) |
| `packages/cli/src/error-registry.json` | New kinds since 0.7.0: `project_root_invalid` (2), `setting_key_not_found` (2), `confirmation_required` (2), `keystore_path_not_found` (2), `secret_required` (2) |
| `packages/cli/src/code-allocations.json` | New codes: `project_root_invalid` 0x6003, `setting_key_not_found` 0x7000, `confirmation_required` 0x7001, `secret_required` 0x7002, `keystore_path_not_found` 0x8000 |
| `packages/upm/com.unictl.editor/Editor/Unictl/Internal/HintTable.cs` | Hint strings for the 5 new kinds |

## Smoke Verification

Drift + bundle:
- `mise run check` — registry / HintTable / code-allocations consistent.
- `bun build cli.ts` — 24 modules clean.

End-to-end on a cloned PickUpCat ProjectSettings fixture
(`/tmp/unictl-fake-project`):

- `input set legacy` → `activeInputHandler: 1` → `0`. ✔
- `scripting set mono --platform android` → `scriptingBackend: { Android: 1 }`
  → expanded `Android: 0`. ✔
- `deploy android keystore set --path test.keystore --alias releaseAlias`
  → `AndroidKeystoreName`, `AndroidKeyaliasName`, `androidUseCustomKeystore=1`
  written, response includes the password-policy `notes`. ✔
- `settings raw-set companyName Tinycell --no-warranty` →
  `companyName: SuperHit` → `Tinycell`. Response includes `previous` value. ✔

Validation paths:
- `input set telepathy` → `invalid_param` exit 2. ✔
- `scripting set il2cpp --platform pluto` → `target_unsupported` exit 2. ✔
- `settings raw-set foo bar` (missing --no-warranty) → `confirmation_required`
  exit 2. ✔
- `settings raw-set foo.bar baz --no-warranty` → `invalid_param` exit 2
  (dotted path rejected). ✔
- `settings raw-set nonExistentKey 999 --no-warranty` →
  `setting_key_not_found` exit 2. ✔

`requireEditorClosed` lifecycle paths (live editor needed) — deferred to
QA pass:
- editor running, no --restart → `editor_running` exit 3.
- editor running, --restart → quit IPC + wait + proceed.
- editor crashed (`died`) → proceeds (treats as closed).

## Out of Scope

- **Live editor runtime apply path**. v0.7 is editor-closed only. A
  future Phase F could add a `[UnictlTool]` settings_apply on the
  editor side that uses `PlayerSettings.SetActiveInputHandler` etc.
  while the editor is up, with the appropriate domain reload handling.

- **Nested raw-set keys**. Dotted paths in `settings raw-set` are
  rejected; users go through `scripting set` for `scriptingBackend.X`.
  Adding nested raw-set is straightforward (`setNestedScalar` already
  exists) but deferred to keep the v0.7 scope tight.

- **Keystore password write**. See "Keystore Password Policy" above.

- **Auto-relaunch after `--restart`**. `input set --restart` quits the
  editor before mutation but does not reopen it. Reopen requires
  spawning Unity with the same project args, which is platform-specific
  and lives on the `unictl editor open` side. Workflow is currently a
  two-step: `unictl input set new --restart` then `unictl editor open`.

## Tracking

Phase E closure on issue siren403/unictl#7. With Phase E closed, the
v0.7 verb-noun tree (Phase C) has functional bodies for all canonical
verbs. Remaining v0.7 plan items:

- Phase F: per-verb `--wait` integration (build, test, editor compile).
- Phase docs / reference materializer pass for the canonical
  describe-all output and the v0.6 → v0.7 migration table.
- v1.0: hard removal of `unictl command` and `--help --json`.
