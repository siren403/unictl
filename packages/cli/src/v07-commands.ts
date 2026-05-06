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
} as const;

function readFlags(args: Record<string, unknown>): OutputFlags {
  if (args.json === true) return { json: true };
  if (args.json === false) return { noJson: true };
  return {};
}

function notImplemented(verb: string, plannedPhase: string): unknown {
  return {
    ok: false,
    error: {
      kind: "not_implemented",
      message: `'${verb}' is a Phase C skeleton stub; functional implementation arrives in Phase ${plannedPhase}.`,
      recovery: `Track progress on issue siren403/unictl#7. Use 'unictl command ...' for now.`,
      hint_command: "unictl command list",
      exit_code: 78, // EX_CONFIG-style: feature not configured/built yet
    },
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
      const flags = readFlags(args as Record<string, unknown>);
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
        const payload = {
          ok: false,
          error: {
            kind: "ipc_error",
            message,
            exit_code: 125,
          },
        };
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
    const flags = readFlags(args as Record<string, unknown>);
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
    const flags = readFlags(args as Record<string, unknown>);
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
    const flags = readFlags(args as Record<string, unknown>);
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
    const flags = readFlags(args as Record<string, unknown>);
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
    const flags = readFlags(args as Record<string, unknown>);
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
