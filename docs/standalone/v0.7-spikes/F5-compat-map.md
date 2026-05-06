# F.5 -- v0.6 CLI Surface Compatibility Map

Generated: 2026-05-06
Source files scanned: `packages/cli/src/cli.ts`, `build.ts`, `test.ts`, `editor.ts`, `compile.ts`, `help-json.ts`, `error.ts`

---

## Summary by disposition

| Disposition  | Count | Commands |
|---|---|---|
| `unchanged`  | 8     | `editor status`, `editor quit`, `editor open`, `editor restart`, `doctor`, `init`, `version`, `test` |
| `wrap-warn`  | 12    | `build`, `compile`, `command` (+ 5 action= variants), `health`, `capabilities`, `--help --json` |
| `rename`     | 0     | -- |
| `hard-error` | 0     | -- |

**Total discrete v0.6 invocation forms catalogued: 20**
(12 wrap-warn + 8 unchanged; includes 5 editor_control action= variants and 1 meta-flag intercept)

The v0.6 surface is almost entirely promotable to wrap-warn. No path was assessed as a candidate for hard-error because every v0.6 path has a clearly corresponding v0.7 equivalent and breaking callers before v1.0 is not justified.

---

## Per-command rationale

### `unictl build` -- `wrap-warn`

Entry point: `packages/cli/src/build.ts:108` (exported `buildCmd`, registered at `cli.ts:735`).

In v0.7 the `editor` noun groups all editor-lifecycle verbs. `build` belongs under it as `unictl editor build`. All existing flags (`--target`, `--output`, `--scenes`, `--define`, `--build-profile`, `--development`, `--allow-debugging`, `--wait`, `--timeout`, `--batch`, `--force-ipc`, `--job-id`, `--project`) carry over unchanged. The shim registers `unictl build` as a legacy alias that prints one deprecation line to stderr and delegates to `unictl editor build`.

Flag normalisation note: `--dry-run`, `--repo-url`, `--package-ref`, `--skip-precompile` are camelCase-converted by `normalizeKnownFlags` (`cli.ts:386`). `build` does not use these flags, so there is no interaction to worry about.

---

### `unictl compile` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:503` (inline `compileCmd`, calls `runCompile` from `compile.ts:29`).

Headless batchmode compile. Moves to `unictl editor compile` for the same noun-grouping reason as `build`. Flags: `--project`, `--timeout`, `--log-file` (normalised from `--logFile`). The shim must normalise `--logFile` -> `--log-file` consistently; the existing `normalizeKnownFlags` handles `--skip-precompile` already -- `--log-file` normalisation should be verified or added there.

One subtle point: compile.ts error text (`line 42`) contains the hint string `"unictl command editor_control -p action=refresh"`. When the shim lands, the hint should be updated to `"unictl editor refresh"` in the same C8 PR.

---

### `unictl editor status` -- `unchanged`

Entry point: `packages/cli/src/cli.ts:407`.

Already in verb-noun shape (`editor` noun, `status` verb). Path, flags, and output shape are identical in v0.7. No shim required.

---

### `unictl editor quit` -- `unchanged`

Entry point: `packages/cli/src/cli.ts:426`.

Already in verb-noun shape. `--force` flag is preserved. No shim required.

---

### `unictl editor open` -- `unchanged`

Entry point: `packages/cli/src/cli.ts:450`.

Already in verb-noun shape. `--skip-precompile` is normalised by `normalizeKnownFlags`. No shim required.

---

### `unictl editor restart` -- `unchanged`

Entry point: `packages/cli/src/cli.ts:474`.

Already in verb-noun shape. No shim required.

---

### `unictl command <tool>` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:566`.

The generic IPC dispatch surface. v0.7 renames to `unictl tool invoke <tool>` (`tool` noun, `invoke` verb) so the low-level escape hatch is clearly labelled as such. The param resolution chain (`-p key=value` / `@file.json` / stdin JSON) is preserved identically. The shim registers `unictl command` as a legacy path that warns once and delegates to `unictl tool invoke`.

The no-argument form (`unictl command` with no positional or with `tool=list`) emits the registered tool list. v0.7 surfaces this as `unictl tool list`. The same shim covers both cases.

---

### `unictl command editor_control -p action=status` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:566` (routed through `command`).

High-frequency agent invocation. The `editor_control` UnictlTool with `action=status` is the predecessor of `unictl editor status`. Covered automatically by the `unictl command` wrap-warn shim; no additional shim code required. However, the F1 migration guide must document this mapping explicitly because agents tend to have hard-coded `unictl command editor_control -p action=...` invocations.

---

### `unictl command editor_control -p action=play` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:566`.

Maps to the new `unictl editor play` verb introduced in v0.7 Phase D (listed explicitly in D4). Covered by `unictl command` shim.

---

### `unictl command editor_control -p action=stop` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:566`.

Maps to `unictl editor stop` (Phase D, D4). Covered by `unictl command` shim.

---

### `unictl command editor_control -p action=refresh` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:566`.

Maps to `unictl editor refresh` (Phase D, D4). Also referenced in `compile.ts:42` error hint text which must be updated in C8.

---

### `unictl command editor_control -p action=compile` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:566`.

In-editor compile trigger via IPC (distinct from headless `unictl compile`). Maps to `unictl editor compile` (IPC lane, Phase D, D4). Covered by `unictl command` shim.

---

### `unictl health` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:597`.

Top-level `health` verb moves under `editor` noun as `unictl editor health` in v0.7. This is a one-flag (`--project`) command with a simple output shape, so the shim is trivial. Deprecation warning: `"unictl health is deprecated; use unictl editor health"`.

---

### `unictl doctor` -- `unchanged`

Entry point: `packages/cli/src/cli.ts:636`.

Doctor is a cross-cutting diagnostic (checks manifest, endpoint, health, version alignment). It is not scoped to a single noun and stays top-level in v0.7. No shim needed. One concern: doctor internally calls `editorStatus` and `health`, so when those implementations move in Phase C, doctor must be updated to call through the new paths -- but the CLI surface stays the same.

---

### `unictl init` -- `unchanged`

Entry point: `packages/cli/src/cli.ts:660`.

Package manifest installer. Operates on `Packages/manifest.json`, not on a running editor. It does not fit naturally under any single noun group and stays top-level in v0.7. All flags are normalised by `normalizeKnownFlags` (`--dry-run` -> `--dryRun`, `--repo-url` -> `--repoUrl`, `--package-ref` -> `--packageRef`). No shim needed.

---

### `unictl version` -- `unchanged`

Entry point: `packages/cli/src/cli.ts:614`.

Version metadata query. Top-level in both v0.6 and v0.7. No shim needed.

---

### `unictl capabilities` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:625`.

Offline agent-discovery JSON. v0.7 moves this under the `tool` noun as `unictl tool capabilities`, alongside `tool list` and `tool invoke`, making the tool-discovery surface coherent. Deprecation warning: `"unictl capabilities is deprecated; use unictl tool capabilities"`. Output shape (`capabilities.json` content) is unchanged.

---

### `unictl test` -- `unchanged`

Entry point: `packages/cli/src/test.ts:433`.

The v0.7 plan (Phase D, D4) lists `test editmode` and `test playmode` as explicit `--wait` target verbs, implying `test` is the stable noun and the `--platform` flag carries the sub-mode. The top-level path `unictl test` stays unchanged. Flags preserved: `--batch`, `--platform`, `--results`, `--filter`, `--timeout`, `--editor-version`, `--project`, `--allow-unsaved-scenes`, `--allow-reload-active`.

No shim needed. However the F1 migration guide should note that `--allow-unsaved-scenes` and `--allow-reload-active` are editor-lane-only; they are silently ignored in `--batch` mode (current behaviour), which is a footgun for callers that switch lanes.

---

### `unictl --help --json [<subcommand>]` -- `wrap-warn`

Entry point: `packages/cli/src/cli.ts:752` (pre-citty intercept block, lines 752-791).

The `--help --json` intercept currently produces a structured help object from `capabilities.json` via `formatHelpJson` (`help-json.ts:36`). Per v0.7 plan sections C1, C7, and the cross-phase note on `--describe` vs `--help --json`:

> `--describe` is canonical in v0.7. `--help --json` is documented as an alias and scheduled for removal in v1.0.

The C8 shim should make `--help --json` emit a stderr deprecation warning and delegate to `--describe`. The output shapes differ slightly today (`--help --json` returns a capabilities-driven object; `--describe` will return the C1-specified schema), so C8 must either harmonise the shapes or document the difference in the migration guide.

---

## Open questions and judgment calls

### OQ-1: `editor_control` action inventory

The `editor_control` UnictlTool is implemented on the C# side and its full action set is not visible from CLI source alone. This spike catalogues only the four actions referenced in CLI source or error hint strings (`status`, `play`, `stop`, `refresh`, `compile`). Any additional `action=` values (e.g. `pause`, `step`, `screenshot`) that exist in the C# tool but are not surfaced as first-class v0.7 verbs need separate disposition decisions. **Recommendation**: grep the UPM C# source for all `action` string matches in `editor_control` before C8 begins, and add entries for any uncatalogued actions.

### OQ-2: `unictl command capture_ui` and other named tools

`commandCmd` is generic: it dispatches to any registered `[UnictlTool]`. Beyond `editor_control`, the CLI source references `build_project`, `build_status`, `test_run` as IPC tool names (in `build.ts:304`, `test.ts:328`). These are internal IPC tool names, not top-level CLI commands, so they are not separate CLI entry points -- but the F1 migration guide should clarify that `unictl command build_project` / `unictl command test_run` are internal and that callers should use `unictl editor build` / `unictl test` instead.

### OQ-3: `--help --json` output shape delta

`formatHelpJson` (`help-json.ts`) currently returns `{ name, description, flags, exit_codes }` driven by `capabilities.json`. The v0.7 `--describe` schema (C1) will return `{ verb_path, args, exit_codes, output_schema_ref, stability_tier }`. These are not identical. C8 must decide whether the `--help --json` shim (a) emits the old shape with a warning, (b) emits the new `--describe` shape with a warning, or (c) emits both under different keys. Option (b) is recommended to reduce consumer confusion.

### OQ-4: `unictl build --build-profile` and `unictl editor build --build-profile`

`--build-profile` is batchmode-only in v0.6 (enforced by IPC lane rejection in `build.ts`). This constraint carries into v0.7. The wrap-warn shim must preserve the rejection path; it must not accidentally allow `--build-profile` through the IPC lane.

### OQ-5: `normalizeKnownFlags` scope for `--log-file`

`compile` uses the flag internally as `logFile` (camelCase citty arg) and accepts `--log-file` from the CLI via `normalizeKnownFlags`. Confirm that the flag alias `--log-file` -> `--logFile` is present in `normalizeKnownFlags` (`cli.ts:386-401`) before C8 ships. Currently the function only normalises `--dry-run`, `--repo-url`, `--package-ref`, `--skip-precompile`. `--log-file` is missing. C8 should add it or document the discrepancy.

### OQ-6: `--json` default flip and legacy entry points

v0.7 plan C7 states: "Legacy v0.6 entrypoints retain v0.6 default (off)." All `wrap-warn` shims must therefore NOT flip `--json` to on-by-default. Only the new verb-noun paths introduced in Phase C get the `--json`-on-by-default treatment. C8 must thread a "is_legacy_path" flag through the output layer.

### OQ-7: `unictl test --batch` lane conflict error vs `unictl editor build --batch`

Both `test` and `build` emit `exit 3 / kind=editor_running` when `--batch` is passed but an editor is running. The exit-code matrix for v0.7 (C6) should confirm that `3` remains the canonical code for "lane unavailable" conflicts so legacy callers do not need to remap error handling.

---

## C8 implementation checklist (derived from this spike)

1. Register `unictl build` as wrap-warn alias for `unictl editor build`.
2. Register `unictl compile` as wrap-warn alias for `unictl editor compile`.
3. Register `unictl command` as wrap-warn alias for `unictl tool invoke`.
4. Register `unictl health` as wrap-warn alias for `unictl editor health`.
5. Register `unictl capabilities` as wrap-warn alias for `unictl tool capabilities`.
6. Make `--help --json` emit deprecation warning and delegate to `--describe` (C8 + C1 must coordinate).
7. Update `compile.ts:42` hint string from `unictl command editor_control -p action=refresh` to `unictl editor refresh`.
8. Add `--log-file` -> `--logFile` to `normalizeKnownFlags` (or document why it is absent).
9. Verify all shims preserve v0.6 `--json`-off-by-default output (OQ-6).
10. Audit C# `editor_control` action set for undocumented action values (OQ-1).
11. Add F1 migration guide entries for `editor_control` action=* -> first-class verb mappings.
