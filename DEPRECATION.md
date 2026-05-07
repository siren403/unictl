# Deprecation Notices

## v0.6-style builtin invocations via `unictl command` (deprecated as of v0.7.0)

> **Correction note** (v0.7.1): the v0.7.0 release of this file said
> "`unictl command` is removed in v1.0". That was wrong. `unictl command`
> is the canonical dispatcher for **consumer-defined `[UnictlTool]`
> classes** and stays in the CLI. Only the specific *invocation patterns*
> that have a v0.7 verb equivalent are deprecated; the dispatcher itself
> is permanent.

The v0.7 verb-noun tree provides direct verbs for a handful of builtin
tools that used to be reachable only through `unictl command`. When you
call those builtins via the legacy form, v0.7 prints a one-line
`[deprecated]` stderr hint suggesting the new verb. Functional behavior
is unchanged.

| Legacy invocation pattern (deprecated) | v0.7 verb-noun equivalent |
|----------------------------------------|---------------------------|
| `unictl command editor_control -p action=play` | `unictl editor play` |
| `unictl command editor_control -p action=stop` | `unictl editor stop` |
| `unictl command editor_control -p action=compile` | `unictl editor compile` |
| `unictl command editor_control -p action=refresh` | `unictl editor refresh` |
| `unictl command list` | `unictl describe-all` |

The deprecation hint is emitted only for the patterns above. v1.0 will
hard-remove these specific call shapes (the runtime mapping table goes
away, and `unictl command editor_control -p action=play` will return an
unknown-tool error). Consumers should migrate those call sites before
v1.0.

### What is NOT deprecated

- The `unictl command <tool>` verb itself — it remains the canonical
  dispatcher for consumer-defined `[UnictlTool]` classes (see below).
- Builtin tools that have **no** v0.7 verb-noun equivalent yet:
  `capture_ui`, `editor_log`, `execute_menu`, `ping`, `ugui_input`,
  `ui_toolkit_input`, `build_status`, `build_cancel`,
  `editor_control -p action=load_scene`. These continue to be invoked
  via `unictl command <tool>` until/unless a future minor release
  introduces verb-noun hosts for them.
- Any third-party `[UnictlTool]` registered in a consumer Unity project.

### Custom `[UnictlTool]` invocation (permanent — NOT deprecated)

Consumer projects can register their own tools via the `[UnictlTool]`
attribute on a static C# class with a `HandleCommand(JObject)` entry
point. unictl discovers them at runtime via assembly scan in
`ToolRouter.cs`:

```csharp
// Editor/MyTools/MySaveInspector.cs in a consumer project
[UnictlTool(Name = "my_save_inspector",
            Description = "Inspect player save state via IPC")]
public static class MySaveInspector {
    public static object HandleCommand(JObject p) {
        // ... return any JSON-serializable result
    }
}
```

```bash
# Invocation — this path is permanent.
unictl command my_save_inspector -p target=Player
```

This is the supported, permanent path for consumer-defined tools.
Future versions may rename the verb (e.g. to `unictl tool <name>`) but
the *capability* of dispatching arbitrary `[UnictlTool]` registrations
through the CLI will not be removed.

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
