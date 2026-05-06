# F.3 -- --wait Default Timeout Matrix

Spike output for Phase 0 item F.3.
Pass criterion: default + override matrix exists.

---

## Default timeouts (verb x state)

| Verb            | --wait state | Default timeout | Reasoning                                                                 |
|-----------------|--------------|-----------------|---------------------------------------------------------------------------|
| editor compile  | idle         | 120s            | compile p50 ~10s, p99 ~60s on large projects; reload adds up to 30s; 120s gives 2x headroom without hitting user irritation at 5min |
| editor play     | playing      | 15s             | play mode entry is 0.5-3s typical; 15s covers slow asset-heavy scenes and the domain-reload-on-enter path |
| editor stop     | idle         | 30s             | mode exit triggers a domain reload (up to 30s ceiling per A4); 30s matches the reload ceiling exactly |
| editor refresh  | idle         | 90s             | asset refresh can import textures/shaders; p50 a few seconds, p99 can be minutes for large asset sets; 90s is a pragmatic CI default -- override for asset-heavy projects |
| test editmode   | idle         | 300s (5min)     | test suite wall time is unbounded in principle; 5min covers most small-to-medium suites; CI operators should override per suite size |
| test playmode   | idle         | 300s (5min)     | same reasoning as editmode; playmode adds play-enter overhead (~3s) which is negligible against suite time |
| (any)           | reachable    | 120s            | matches existing editorOpen /health polling ceiling (editor.ts:230); covers cold launch including precompile |
| (any)           | reloading    | 30s             | A4 defines the reload ceiling as 30s; after 30s without heartbeat the state transitions to `unresponsive` |
| (any)           | quit         | 15s             | matches existing editorQuit 15s poll window (editor.ts:160); after 15s a SIGTERM/force-kill fallback fires |

---

## Override mechanism

### --timeout flag

Pass a duration directly on any command that accepts --wait:

```
unictl editor compile --wait idle --timeout 5m
unictl test editmode  --wait idle --timeout 0
```

Accepted formats:

| Input   | Parsed as    |
|---------|--------------|
| `30s`   | 30 seconds   |
| `2m`    | 120 seconds  |
| `1h`    | 3600 seconds |
| `120`   | 120 seconds (bare integer = seconds) |
| `0`     | unbounded (no timeout fires) |

On timeout, the CLI exits with code 124 and emits `{ok:false, code:<N>, kind:"wait_timeout"}` per C6/D5.
SIGINT during --wait exits with code 130 and `kind:"interrupted"` per D7.

### Environment variable overrides

Operators tuning defaults for a fleet or CI image can set per-verb env overrides without
touching call sites:

```
UNICTL_WAIT_TIMEOUT_DEFAULT_EDITOR_COMPILE=300s   # large monorepo
UNICTL_WAIT_TIMEOUT_DEFAULT_TEST_EDITMODE=0       # unbounded for full regression suite
UNICTL_WAIT_TIMEOUT_DEFAULT_ANY_REACHABLE=180s    # slow CI machines
```

Naming convention: `UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB_DOTPATH_AS_UPPERCASE_UNDERSCORE>`.
The `ANY` prefix applies to any verb for cross-cutting states (`reachable`, `reloading`, `quit`).
A --timeout flag always wins over the env override; the env override wins over the compiled default.

Precedence (highest to lowest):
1. `--timeout <duration>` on the CLI call
2. `UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB>` env var
3. Compiled default from the matrix above

---

## Rationale per default

**editor compile -> idle (120s)**
Typical compile is 2-30s; domain reload after compile adds up to 30s (A4 ceiling). The 120s
default gives a 2x margin over the realistic p99 (compile 60s + reload 30s = 90s) while staying
well below the 5min user abandonment threshold. CI operators on large projects should use
`--timeout 5m` or the env override.

**editor play -> playing (15s)**
Play mode entry is 0.5-3s in the common case. 15s accommodates scenes that trigger a full
domain reload on entry (DisableDomainReload=false) and asset-heavy scenes with slow Awake paths.
Any project that consistently hits 15s needs `--timeout 30s` and should investigate scene load time.

**editor stop -> idle (30s)**
Stopping play mode always triggers a domain reload (re-serialization + managed restart). The A4
reload ceiling is 30s, so the stop timeout is set to exactly that ceiling. If the reload exceeds
30s the heartbeat transitions to `unresponsive` and the CLI can surface a meaningful error rather
than waiting indefinitely.

**editor refresh -> idle (90s)**
AssetDatabase.Refresh() is highly variable: a few seconds for source-only changes, potentially
minutes for large texture imports. 90s is chosen as a CI-friendly default that covers most
incremental refresh cases. Projects with large asset pipelines (texture atlases, addressables)
should set `--timeout 10m` or use the env override.

**test editmode / test playmode -> idle (300s)**
Test suite wall time is project-specific and cannot be predicted by the CLI. 300s (5min) is the
user abandonment threshold identified in the considerations and covers small-to-medium suites.
Anything beyond that should override explicitly. The existing batch-mode test runner also uses
an operator-supplied --timeout (test.ts:140) with no compiled default, so 300s represents a
safe baseline rather than a hard constraint.

**(any) -> reachable (120s)**
Matches the existing editorOpen /health polling ceiling in editor.ts (line 230: `Date.now() + 120_000`).
Covers the cold-launch path including the precompile batchmode pass which can itself take 30-60s.

**(any) -> reloading (30s)**
Directly mirrors the A4 reload ceiling. The `reloading` state is transient by definition; if it
lasts longer than 30s the heartbeat stales and the state machine moves to `unresponsive`. Waiting
longer than the ceiling serves no purpose.

**(any) -> quit (15s)**
Matches the existing editorQuit graceful-poll window (editor.ts line 160: `Date.now() + 15_000`).
After 15s the current implementation falls back to SIGTERM then SIGKILL. The --wait quit path
follows the same budget so the two code paths stay consistent.

---

## Edge cases

### Large project (compile p99 > 60s)

Projects with 500k+ LOC or heavy generated code can push compile time beyond 60s. Recommended
approach:

- Interactive dev: `--timeout 3m` for compile, `--timeout 10m` for editmode tests.
- CI: `UNICTL_WAIT_TIMEOUT_DEFAULT_EDITOR_COMPILE=5m` in the CI environment, then all
  pipeline steps inherit it without per-call changes.
- If compile routinely exceeds 120s, treat it as a signal to investigate incremental compile
  health (assembly definition boundaries, type cache freshness) rather than just raising the
  timeout ceiling.

### CI vs interactive

In CI, unbounded waits (`--timeout 0`) risk hanging a pipeline job forever on a stuck editor.
Prefer an explicit ceiling (`--timeout 10m`) plus a separate CI job-level timeout as a backstop.
In interactive use, the compiled defaults are intentionally conservative (short enough to surface
problems quickly without being so short they fire on normal machines).

The `UNICTL_HUMAN=1` env var (C7) switches output to human-readable mode but does not change
timeout behavior -- operators must set timeouts separately.

### Reload-aware re-arm (D6 / A4 interaction)

When a --wait poll encounters state `reloading`, the timeout clock is paused. Once the state
transitions back to `idle`, the clock resumes from where it was paused (remaining budget is
preserved). This re-arm is capped by the (any)->reloading default of 30s: if the reload itself
exceeds 30s the heartbeat goes `unresponsive` and --wait surfaces a `wait_timeout` or
`editor_unresponsive` error rather than silently consuming budget.

Example: `editor compile --wait idle --timeout 60s` on a project where compile takes 40s and
the subsequent reload takes 20s:
- 0s-40s: state=compiling, timeout clock running, 20s budget remaining.
- 40s-60s: state=reloading, timeout clock paused, budget held at 20s.
- 60s: state=idle, wait resolves successfully with 20s budget to spare.

If the reload were to exceed 30s (A4 ceiling), the heartbeat would go `unresponsive` at the 30s
mark, the re-arm would not fire, and --wait would exit 124 with `kind:"wait_timeout"` plus a
hint to check editor health.
