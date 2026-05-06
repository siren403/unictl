// Phase C3 of unictl v0.7 — verb-noun command tree skeleton.
//
// New v0.7 commands live here as a single module to keep the diff inspectable.
// Editor sub-verbs (compile/play/stop/refresh) are functional — they delegate
// to the existing `editor_control` IPC tool. Other v0.7 nouns (input, deploy,
// scripting, settings, wait) are skeleton stubs that emit a structured
// not-implemented envelope; functional bodies arrive in:
//   - wait      → Phase D
//   - input     → Phase E
//   - deploy    → Phase E
//   - scripting → Phase E
//   - settings  → Phase E
//
// Per critic 1.5 + C7: every command here defaults `--json` ON. UNICTL_HUMAN=1
// or `--no-json` forces human output via the shared `output.ts` utility.

import { defineCommand } from "citty";
import { command as ipcCommand } from "./client";
import { emit, exitCodeFor, type OutputFlags } from "./output";
import { lookupDescribe } from "./describe";
import { errorEnvelope } from "./error";
import {
  WAIT_STATES,
  type WaitState,
  parseDuration,
  lookupTimeoutDefault,
  runWait,
  outcomeToEnvelope,
} from "./wait";
import {
  loadProjectSettings,
  saveProjectSettings,
  setTopLevelScalar,
  setNestedScalar,
  getTopLevelScalar,
  resolvePlatformYamlKey,
} from "./project-settings";
import { requireEditorClosed } from "./settings";
import { existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// ---------------------------------------------------------------------------
// Shared flag / response helpers
// ---------------------------------------------------------------------------

/**
 * Args block reused by every v0.7 command. Citty's boolean negation gives us
 * `--json` and `--no-json` from a single arg definition (see citty docs):
 *   - `--json`    → args.json === true
 *   - `--no-json` → args.json === false
 *   - omitted     → args.json === undefined
 */
const v07GlobalArgs = {
  project: {
    type: "string",
    description: "Unity project path (auto-detected if omitted)",
  },
  json: {
    type: "boolean",
    description: "Force JSON output (default ON for v0.7); use --no-json or UNICTL_HUMAN=1 for human output",
  },
  describe: {
    type: "boolean",
    description: "Emit canonical agent metadata (DescribeMetadata) as JSON and exit without running the command",
  },
} as const;

function readFlags(args: Record<string, unknown>): OutputFlags {
  if (args.json === true) return { json: true };
  if (args.json === false) return { noJson: true };
  return {};
}

/**
 * Short-circuit: if `--describe` is set, emit the metadata for `name` and
 * exit 0. Returns true if the command should NOT continue executing.
 *
 * Per critic 4.0 + C-describe: --describe is the canonical agent metadata
 * channel. If a command name is missing from the registry the caller falls
 * back to its normal path (so a typo here doesn't silently break the verb).
 */
function maybeEmitDescribe(name: string, args: Record<string, unknown>, flags: OutputFlags): boolean {
  if (args.describe !== true) return false;
  const meta = lookupDescribe(name);
  if (!meta) return false;
  emit("new", meta, flags);
  process.exit(0);
}

function notImplemented(verb: string, plannedPhase: string, related: readonly string[] = []) {
  // Wrap the v0.7 errorEnvelope and tack on the v0.7 stub-specific exit_code so
  // exitCodeFor() picks 78 (EX_CONFIG-style: feature not configured/built yet).
  const env = errorEnvelope({
    kind: "not_implemented",
    message: `'${verb}' is a Phase C skeleton stub; functional implementation arrives in Phase ${plannedPhase}.`,
    recovery: "Track progress on issue siren403/unictl#7. Use 'unictl command ...' for now.",
    related,
    context: { planned_phase: plannedPhase, verb },
  });
  return {
    ...env,
    error: { ...env.error, exit_code: 78 },
  };
}

// ---------------------------------------------------------------------------
// editor.compile / play / stop / refresh — functional via editor_control IPC
// ---------------------------------------------------------------------------

function makeEditorActionCommand(action: string, summary: string) {
  return defineCommand({
    meta: { name: action, description: summary },
    args: { ...v07GlobalArgs },
    run: async ({ args }) => {
      const argMap = args as Record<string, unknown>;
      const flags = readFlags(argMap);
      if (maybeEmitDescribe(`editor.${action}`, argMap, flags)) return;
      try {
        const result = await ipcCommand(
          "editor_control",
          { action },
          { project: args.project as string | undefined },
        );
        const payload = { ok: true, action, result };
        emit("new", payload, flags);
        process.exit(exitCodeFor(payload));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const env = errorEnvelope({
          kind: "ipc_error",
          message,
          recovery: "Verify the editor is running with 'unictl health'; if reloading, retry or use 'unictl wait reachable'.",
          related: [`editor.${action}`, "editor.status"],
          context: { action },
        });
        const payload = { ...env, error: { ...env.error, exit_code: 125 } };
        emit("new", payload, flags);
        process.exit(exitCodeFor(payload));
      }
    },
  });
}

const editorCompileCmd = makeEditorActionCommand(
  "compile",
  "Trigger an in-editor recompile (different from 'unictl compile' batchmode).",
);
const editorPlayCmd = makeEditorActionCommand("play", "Enter Play Mode in the running editor.");
const editorStopCmd = makeEditorActionCommand("stop", "Exit Play Mode.");
const editorRefreshCmd = makeEditorActionCommand("refresh", "Run AssetDatabase.Refresh.");

// ---------------------------------------------------------------------------
// input.set — Phase E stub
// ---------------------------------------------------------------------------

const inputSetCmd = defineCommand({
  meta: {
    name: "set",
    description: "Switch the Unity Input System handler (legacy/new/both). Lifecycle-aware (closes editor with --restart).",
  },
  args: {
    ...v07GlobalArgs,
    handler: {
      type: "positional",
      required: true,
      description: "legacy | new | both",
    },
    restart: {
      type: "boolean",
      description: "Auto-orchestrate editor close → modify → optional relaunch",
    },
  },
  run: async ({ args }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("input.set", argMap, flags)) return;

    const handler = String(args.handler).trim().toLowerCase();
    const handlerCode: Record<string, number> = { legacy: 0, new: 1, both: 2 };
    if (!(handler in handlerCode)) {
      const env = errorEnvelope({
        kind: "invalid_param",
        message: `Unknown input handler '${handler}'. Valid: legacy, new, both.`,
        related: ["input.set"],
        context: { handler, valid: ["legacy", "new", "both"] },
      });
      const payload = { ...env, error: { ...env.error, exit_code: 2 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }

    const pre = await requireEditorClosed({
      project: args.project as string | undefined,
      restart: args.restart === true,
      intent: "input set",
    });
    if (!pre.ok) {
      emit("new", pre.envelope, flags);
      process.exit(exitCodeFor(pre.envelope));
    }

    try {
      const content = loadProjectSettings(pre.projectRoot);
      const updated = setTopLevelScalar(content, "activeInputHandler", String(handlerCode[handler]));
      saveProjectSettings(pre.projectRoot, updated);
      const payload = {
        ok: true,
        action: "input.set",
        applied: { handler, value: handlerCode[handler] },
        project_root: pre.projectRoot,
      };
      emit("new", payload, flags);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = (err as { kind?: string })?.kind ?? "ipc_error";
      const env = errorEnvelope({
        kind,
        message,
        recovery: "Run 'unictl doctor' for diagnostics.",
        related: ["doctor", "input.set"],
        context: { intent: "input set" },
      });
      const payload = { ...env, error: { ...env.error, exit_code: kind === "setting_key_not_found" ? 2 : 125 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }
  },
});

const inputCmd = defineCommand({
  meta: { name: "input", description: "Unity Input System lifecycle commands" },
  subCommands: { set: inputSetCmd },
});

// ---------------------------------------------------------------------------
// deploy.android.keystore.set — Phase E stub
// ---------------------------------------------------------------------------

const deployAndroidKeystoreSetCmd = defineCommand({
  meta: {
    name: "set",
    description: "Configure Android keystore path + alias in ProjectSettings.asset and enable custom keystore. Passwords NOT persisted (supply at build via env vars).",
  },
  args: {
    ...v07GlobalArgs,
    path: {
      type: "string",
      required: true,
      description: "Keystore file path (relative to project root or absolute)",
    },
    alias: {
      type: "string",
      required: true,
      description: "Key alias",
    },
  },
  run: async ({ args }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("deploy.android.keystore.set", argMap, flags)) return;

    const path = String(args.path);
    const alias = String(args.alias);

    const pre = await requireEditorClosed({
      project: args.project as string | undefined,
      intent: "deploy android keystore set",
    });
    if (!pre.ok) {
      emit("new", pre.envelope, flags);
      process.exit(exitCodeFor(pre.envelope));
    }

    const resolvedKeystore = resolvePath(pre.projectRoot, path);
    if (!existsSync(resolvedKeystore)) {
      const env = errorEnvelope({
        kind: "keystore_path_not_found",
        message: `Keystore file not found at '${resolvedKeystore}'.`,
        recovery: "Verify --path resolves to an existing .keystore/.jks file.",
        related: ["deploy.android.keystore.set"],
        context: { path, resolved: resolvedKeystore },
      });
      const payload = { ...env, error: { ...env.error, exit_code: 2 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }

    try {
      let content = loadProjectSettings(pre.projectRoot);
      const normalizedPath = resolvedKeystore.replace(/\\/g, "/");
      content = setTopLevelScalar(content, "AndroidKeystoreName", normalizedPath);
      content = setTopLevelScalar(content, "AndroidKeyaliasName", alias);
      content = setTopLevelScalar(content, "androidUseCustomKeystore", "1");
      saveProjectSettings(pre.projectRoot, content);

      const payload = {
        ok: true,
        action: "deploy.android.keystore.set",
        applied: {
          path: normalizedPath,
          alias,
          android_use_custom_keystore: 1,
        },
        notes: [
          "Passwords are intentionally NOT written to ProjectSettings.asset (committed file).",
          "Supply at build time via UNITY_ANDROID_KEYSTORE_PASS / UNITY_ANDROID_KEYALIAS_PASS env vars,",
          "or via -keystorePass / -keyaliasPass arguments to a Unity batchmode build.",
        ],
        project_root: pre.projectRoot,
      };
      emit("new", payload, flags);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = (err as { kind?: string })?.kind ?? "ipc_error";
      const env = errorEnvelope({
        kind,
        message,
        recovery: "Run 'unictl doctor' for diagnostics.",
        related: ["doctor", "deploy.android.keystore.set"],
        context: { intent: "deploy android keystore set" },
      });
      const payload = { ...env, error: { ...env.error, exit_code: kind === "setting_key_not_found" ? 2 : 125 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }
  },
});

const deployAndroidKeystoreCmd = defineCommand({
  meta: { name: "keystore", description: "Android keystore commands" },
  subCommands: { set: deployAndroidKeystoreSetCmd },
});

const deployAndroidCmd = defineCommand({
  meta: { name: "android", description: "Android-specific deploy commands" },
  subCommands: { keystore: deployAndroidKeystoreCmd },
});

const deployCmd = defineCommand({
  meta: { name: "deploy", description: "Deploy / sign-time settings" },
  subCommands: { android: deployAndroidCmd },
});

// ---------------------------------------------------------------------------
// scripting.set — Phase E stub
// ---------------------------------------------------------------------------

const scriptingSetCmd = defineCommand({
  meta: {
    name: "set",
    description: "Toggle scripting backend (mono/il2cpp) per platform.",
  },
  args: {
    ...v07GlobalArgs,
    backend: {
      type: "positional",
      required: true,
      description: "mono | il2cpp",
    },
    platform: {
      type: "string",
      required: true,
      description: "Target platform (e.g. android, ios, standalone)",
    },
  },
  run: async ({ args }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("scripting.set", argMap, flags)) return;

    const backend = String(args.backend).trim().toLowerCase();
    const backendCode: Record<string, number> = { mono: 0, mono2x: 0, "mono-2x": 0, il2cpp: 1 };
    if (!(backend in backendCode)) {
      const env = errorEnvelope({
        kind: "invalid_param",
        message: `Unknown scripting backend '${backend}'. Valid: mono, il2cpp.`,
        related: ["scripting.set"],
        context: { backend, valid: ["mono", "il2cpp"] },
      });
      const payload = { ...env, error: { ...env.error, exit_code: 2 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }

    const platformYaml = resolvePlatformYamlKey(String(args.platform));
    if (!platformYaml) {
      const env = errorEnvelope({
        kind: "target_unsupported",
        message: `Unknown platform '${args.platform}'. See 'unictl scripting set --describe'.`,
        related: ["scripting.set"],
        context: { platform: args.platform },
      });
      const payload = { ...env, error: { ...env.error, exit_code: 2 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }

    const pre = await requireEditorClosed({
      project: args.project as string | undefined,
      intent: "scripting set",
    });
    if (!pre.ok) {
      emit("new", pre.envelope, flags);
      process.exit(exitCodeFor(pre.envelope));
    }

    try {
      const content = loadProjectSettings(pre.projectRoot);
      const updated = setNestedScalar(content, "scriptingBackend", platformYaml, String(backendCode[backend]));
      saveProjectSettings(pre.projectRoot, updated);
      const payload = {
        ok: true,
        action: "scripting.set",
        applied: { backend, platform: platformYaml, value: backendCode[backend] },
        project_root: pre.projectRoot,
      };
      emit("new", payload, flags);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = (err as { kind?: string })?.kind ?? "ipc_error";
      const env = errorEnvelope({
        kind,
        message,
        recovery: "Run 'unictl doctor' for diagnostics.",
        related: ["doctor", "scripting.set"],
        context: { intent: "scripting set", platform: platformYaml },
      });
      const payload = { ...env, error: { ...env.error, exit_code: kind === "setting_key_not_found" ? 2 : 125 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }
  },
});

const scriptingCmd = defineCommand({
  meta: { name: "scripting", description: "Scripting backend selector" },
  subCommands: { set: scriptingSetCmd },
});

// ---------------------------------------------------------------------------
// settings.raw-set — Phase E stub (escape hatch)
// ---------------------------------------------------------------------------

const settingsRawSetCmd = defineCommand({
  meta: {
    name: "raw-set",
    description: "(escape hatch) Edit a Unity project setting by raw key. Requires --no-warranty. Side effects not guaranteed.",
  },
  args: {
    ...v07GlobalArgs,
    key: {
      type: "positional",
      required: true,
      description: "Setting key path (e.g. m_ActiveInputHandler)",
    },
    value: {
      type: "positional",
      required: true,
      description: "New value (string-typed)",
    },
  },
  run: async ({ args, rawArgs }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("settings.raw-set", argMap, flags)) return;

    // citty/mri treats `--no-foo` as boolean negation of a `foo` arg, so we
    // can't define "no-warranty" via the args schema. Probe rawArgs directly
    // to keep the documented `--no-warranty` flag UX intact.
    const hasNoWarranty = rawArgs.includes("--no-warranty");
    if (!hasNoWarranty) {
      const env = errorEnvelope({
        kind: "confirmation_required",
        message: "settings raw-set requires --no-warranty to acknowledge that raw edits bypass Unity setter side effects.",
        recovery: "Add --no-warranty if you understand the risks. Prefer feature bundles (input set, scripting set, deploy keystore set) when one fits.",
        related: ["input.set", "scripting.set", "deploy.android.keystore.set"],
        context: { key: args.key, hint: "feature_bundles_first" },
      });
      const payload = { ...env, error: { ...env.error, exit_code: 2 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }

    const key = String(args.key);
    const value = String(args.value);

    // Reject dotted paths in v1 — nested edits go through feature bundles.
    if (key.includes(".") || key.includes("/")) {
      const env = errorEnvelope({
        kind: "invalid_param",
        message: "settings raw-set v1 only accepts top-level keys; dotted/nested paths are not supported.",
        recovery: "Use the matching feature bundle (e.g. 'unictl scripting set ... --platform Android') for nested keys.",
        related: ["scripting.set"],
        context: { key },
      });
      const payload = { ...env, error: { ...env.error, exit_code: 2 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }

    const pre = await requireEditorClosed({
      project: args.project as string | undefined,
      intent: "settings raw-set",
    });
    if (!pre.ok) {
      emit("new", pre.envelope, flags);
      process.exit(exitCodeFor(pre.envelope));
    }

    try {
      const content = loadProjectSettings(pre.projectRoot);
      const previous = getTopLevelScalar(content, key);
      const updated = setTopLevelScalar(content, key, value);
      saveProjectSettings(pre.projectRoot, updated);
      const payload = {
        ok: true,
        action: "settings.raw-set",
        applied: { key, value, previous },
        project_root: pre.projectRoot,
      };
      emit("new", payload, flags);
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const kind = (err as { kind?: string })?.kind ?? "ipc_error";
      const env = errorEnvelope({
        kind,
        message,
        recovery: kind === "setting_key_not_found"
          ? `Key '${key}' is not a top-level scalar in ProjectSettings.asset. Inspect the file or use a feature bundle.`
          : "Run 'unictl doctor' for diagnostics.",
        related: ["doctor", "settings.raw-set"],
        context: { intent: "settings raw-set", key },
      });
      const payload = { ...env, error: { ...env.error, exit_code: kind === "setting_key_not_found" ? 2 : 125 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }
  },
});

const settingsCmd = defineCommand({
  meta: { name: "settings", description: "Project settings escape hatch (rarely needed; prefer feature bundles)" },
  subCommands: { "raw-set": settingsRawSetCmd },
});

// ---------------------------------------------------------------------------
// wait <state> — Phase D: pull-loop on /liveness with reload-aware re-arm
// ---------------------------------------------------------------------------

const waitCmd = defineCommand({
  meta: {
    name: "wait",
    description: "Block until the editor reaches the given state (idle | playing | compiling | reloading | reachable).",
  },
  args: {
    ...v07GlobalArgs,
    state: {
      type: "positional",
      required: true,
      description: "Target state (idle | playing | compiling | reloading | reachable)",
    },
    timeout: {
      type: "string",
      description: "Timeout (e.g. 30s, 2m, 1h, 120, or 0 for unbounded). Default per F.3 matrix.",
    },
  },
  run: async ({ args }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("wait", argMap, flags)) return;

    // Validate state.
    const state = String(args.state);
    if (!WAIT_STATES.includes(state as WaitState)) {
      const env = errorEnvelope({
        kind: "invalid_param",
        message: `Unknown state '${state}'. Valid: ${WAIT_STATES.join(", ")}.`,
        recovery: "Pass one of the supported states or 'unictl wait --describe' for details.",
        related: ["wait"],
        context: { state, valid_states: WAIT_STATES },
      });
      const payload = { ...env, error: { ...env.error, exit_code: 2 } };
      emit("new", payload, flags);
      process.exit(exitCodeFor(payload));
    }

    // Resolve timeout: --timeout flag > env override > F.3 compiled default.
    let timeoutSeconds: number;
    const flagRaw = args.timeout as string | undefined;
    if (flagRaw !== undefined) {
      const parsed = parseDuration(flagRaw);
      if (Number.isNaN(parsed)) {
        const env = errorEnvelope({
          kind: "invalid_param",
          message: `Cannot parse --timeout '${flagRaw}'. Expected forms: 30s, 2m, 1h, bare integer (seconds), or 0 (unbounded).`,
          recovery: "Pass a duration in the documented format.",
          related: ["wait"],
          context: { timeout_raw: flagRaw },
        });
        const payload = { ...env, error: { ...env.error, exit_code: 2 } };
        emit("new", payload, flags);
        process.exit(exitCodeFor(payload));
      }
      timeoutSeconds = parsed;
    } else {
      // Top-level `unictl wait` is its own verb in the matrix (no parent verb).
      timeoutSeconds = lookupTimeoutDefault("wait", state as WaitState);
    }

    const outcome = await runWait({
      state: state as WaitState,
      timeoutSeconds,
      project: args.project as string | undefined,
    });
    const payload = outcomeToEnvelope(outcome);
    emit("new", payload, flags);
    process.exit(exitCodeFor(payload));
  },
});

// ---------------------------------------------------------------------------
// Exports — registered into the citty tree by cli.ts
// ---------------------------------------------------------------------------

export const v07EditorSubCommands = {
  compile: editorCompileCmd,
  play: editorPlayCmd,
  stop: editorStopCmd,
  refresh: editorRefreshCmd,
};

export const v07TopLevelCommands = {
  input: inputCmd,
  deploy: deployCmd,
  scripting: scriptingCmd,
  settings: settingsCmd,
  wait: waitCmd,
};
