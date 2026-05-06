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
    const payload = notImplemented("input set", "E");
    emit("new", payload, flags);
    process.exit(exitCodeFor(payload as { ok?: boolean; error?: { exit_code?: number } }));
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
    description: "Configure Android keystore credentials for the project.",
  },
  args: {
    ...v07GlobalArgs,
    path: {
      type: "string",
      required: true,
      description: "Keystore file path",
    },
    alias: {
      type: "string",
      required: true,
      description: "Key alias",
    },
    keystorePass: {
      type: "string",
      description: "Keystore password (stdin if omitted)",
    },
    keyPass: {
      type: "string",
      description: "Key password (stdin if omitted)",
    },
  },
  run: async ({ args }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("deploy.android.keystore.set", argMap, flags)) return;
    const payload = notImplemented("deploy android keystore set", "E");
    emit("new", payload, flags);
    process.exit(exitCodeFor(payload as { ok?: boolean; error?: { exit_code?: number } }));
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
    const payload = notImplemented("scripting set", "E");
    emit("new", payload, flags);
    process.exit(exitCodeFor(payload as { ok?: boolean; error?: { exit_code?: number } }));
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
    "no-warranty": {
      type: "boolean",
      description: "Required acknowledgment that raw edits bypass Unity setter side effects",
    },
  },
  run: async ({ args }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("settings.raw-set", argMap, flags)) return;
    const payload = notImplemented("settings raw-set", "E");
    emit("new", payload, flags);
    process.exit(exitCodeFor(payload as { ok?: boolean; error?: { exit_code?: number } }));
  },
});

const settingsCmd = defineCommand({
  meta: { name: "settings", description: "Project settings escape hatch (rarely needed; prefer feature bundles)" },
  subCommands: { "raw-set": settingsRawSetCmd },
});

// ---------------------------------------------------------------------------
// wait <state> — Phase D stub
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
      description: "Target state",
    },
    timeout: {
      type: "string",
      description: "Timeout (e.g. 30s, 2m, 0 for unbounded)",
    },
  },
  run: async ({ args }) => {
    const argMap = args as Record<string, unknown>;
    const flags = readFlags(argMap);
    if (maybeEmitDescribe("wait", argMap, flags)) return;
    const payload = notImplemented("wait", "D");
    emit("new", payload, flags);
    process.exit(exitCodeFor(payload as { ok?: boolean; error?: { exit_code?: number } }));
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
