// Phase C-describe of unictl v0.7 — `--describe` metadata schema + registry.
//
// Per critic 4.0: --describe is the canonical agent metadata channel for v0.7.
// `--help --json` becomes an alias and is scheduled for removal in v1.0.
//
// Each v0.7 verb-noun command attaches its DescribeMetadata via this registry;
// the `--describe` flag handler emits the metadata as JSON and exits 0 without
// running the command body.

export interface DescribeArg {
  name: string;
  type: "string" | "int" | "bool" | "enum" | "path" | "duration" | "positional";
  enumValues?: readonly string[];
  default?: string | number | boolean;
  required: boolean;
  description: string;
}

export interface DescribeExample {
  cmd: string;
  intent: string;
}

export interface DescribeMetadata {
  schema_version: 1;
  /** Canonical id for cross-version correlation, e.g. "editor.play" */
  name: string;
  /** Verb segment, e.g. "play" */
  verb: string;
  /** Noun segment, e.g. "editor" — empty string for top-level verbs */
  noun: string;
  /** One-line summary */
  summary: string;
  /** Concrete trigger conditions for agent selection */
  when: readonly string[];
  /** Anti-trigger conditions — MUST be non-empty per A1/critic 1.5 */
  when_not: readonly string[];
  args: readonly DescribeArg[];
  examples: readonly DescribeExample[];
  exit_codes: readonly number[];
  /** Related command names (matches `name` field in their describe) */
  related: readonly string[];
  since_version: string;
  stability: "stable" | "beta" | "experimental";
}

const SINCE = "0.7.0";
const COMMON_ARGS: readonly DescribeArg[] = [
  {
    name: "project",
    type: "string",
    required: false,
    description: "Unity project path (auto-detected if omitted)",
  },
  {
    name: "json",
    type: "bool",
    default: true,
    required: false,
    description: "Force JSON output (default ON for v0.7); use --no-json or UNICTL_HUMAN=1 for human output",
  },
  {
    name: "describe",
    type: "bool",
    default: false,
    required: false,
    description: "Emit this metadata as JSON instead of running the command",
  },
];

/**
 * Phase F: editor sub-verbs accept --wait <state> + --timeout <dur> on top
 * of COMMON_ARGS. State is optional — omitting it uses the verb-specific
 * F.3 default (compile/refresh/stop → idle, play → playing).
 */
const EDITOR_WAIT_ARGS: readonly DescribeArg[] = [
  {
    name: "wait",
    type: "enum",
    enumValues: ["idle", "playing", "compiling", "reloading", "reachable"],
    required: false,
    description: "Wait for editor state after dispatch (uses F.3 verb default if no value).",
  },
  {
    name: "timeout",
    type: "duration",
    default: "auto",
    required: false,
    description: "Wait timeout (e.g. 30s, 2m, 1h, 0 unbounded). Default per F.3 matrix.",
  },
];

const COMMON_EXIT_CODES: readonly number[] = [0, 1, 2, 78, 124, 125, 126];

export const v07Describes: Record<string, DescribeMetadata> = {
  "editor.compile": {
    schema_version: 1,
    name: "editor.compile",
    verb: "compile",
    noun: "editor",
    summary: "Trigger an in-editor recompile via IPC (different from 'unictl compile' batchmode).",
    when: [
      "After editing C# scripts and you want to verify compilation without closing the editor.",
      "Before running tests that depend on freshly compiled assemblies.",
    ],
    when_not: [
      "Editor is not running — use 'unictl compile' (batchmode) instead.",
      "You need a clean clean compile from a known-empty state — use 'unictl compile' which can spawn a fresh batchmode process.",
    ],
    args: [...COMMON_ARGS, ...EDITOR_WAIT_ARGS],
    examples: [
      { cmd: "unictl editor compile", intent: "trigger in-editor recompile (fire-and-forget)" },
      { cmd: "unictl editor compile --wait idle --timeout 90s", intent: "trigger compile and block until editor returns to idle" },
      { cmd: "unictl editor compile --no-json", intent: "human-readable output" },
    ],
    exit_codes: [0, 2, 3, 124, 125, 130],
    related: ["editor.refresh", "editor.status", "wait"],
    since_version: SINCE,
    stability: "beta",
  },
  "editor.play": {
    schema_version: 1,
    name: "editor.play",
    verb: "play",
    noun: "editor",
    summary: "Enter Play Mode in the running Unity editor.",
    when: [
      "Reproducing a runtime bug that only manifests in Play mode.",
      "Triggering a play-mode test suite that requires manual setup.",
    ],
    when_not: [
      "Editor is currently compiling or importing — call 'unictl wait idle' first (Phase D).",
      "Headless test runs — use 'unictl test playmode --batch' instead.",
    ],
    args: [...COMMON_ARGS, ...EDITOR_WAIT_ARGS],
    examples: [
      { cmd: "unictl editor play --wait playing --timeout 30s", intent: "enter Play mode and block until live (default state: playing)" },
      { cmd: "unictl editor play", intent: "enter Play mode (fire-and-forget)" },
    ],
    exit_codes: [0, 2, 3, 124, 125, 130],
    related: ["editor.stop", "editor.status", "wait"],
    since_version: SINCE,
    stability: "beta",
  },
  "editor.stop": {
    schema_version: 1,
    name: "editor.stop",
    verb: "stop",
    noun: "editor",
    summary: "Exit Play Mode and return to Edit Mode.",
    when: [
      "Cleaning up after an automated play-mode session.",
      "Editor is stuck in Play mode and you want to recover scriptably.",
    ],
    when_not: [
      "Editor is in a compile/reload window — wait for idle first.",
    ],
    args: [...COMMON_ARGS, ...EDITOR_WAIT_ARGS],
    examples: [
      { cmd: "unictl editor stop --wait idle --timeout 30s", intent: "exit Play mode and block until idle (covers reload window)" },
      { cmd: "unictl editor stop", intent: "exit Play mode (fire-and-forget)" },
    ],
    exit_codes: [0, 2, 3, 124, 125, 130],
    related: ["editor.play", "editor.status", "wait"],
    since_version: SINCE,
    stability: "beta",
  },
  "editor.refresh": {
    schema_version: 1,
    name: "editor.refresh",
    verb: "refresh",
    noun: "editor",
    summary: "Run AssetDatabase.Refresh in the editor (re-import changed assets).",
    when: [
      "External tooling modified files in Assets/ and you want the editor to pick them up.",
      "After running 'unictl compile' (batchmode) and the live editor needs to re-sync.",
    ],
    when_not: [
      "Editor is currently importing — duplicate refresh has no benefit.",
    ],
    args: [...COMMON_ARGS, ...EDITOR_WAIT_ARGS],
    examples: [
      { cmd: "unictl editor refresh --wait idle --timeout 90s", intent: "trigger refresh and block until import settles to idle" },
      { cmd: "unictl editor refresh", intent: "re-import changed assets (fire-and-forget)" },
    ],
    exit_codes: [0, 2, 3, 124, 125, 130],
    related: ["editor.compile", "editor.status", "wait"],
    since_version: SINCE,
    stability: "beta",
  },
  "input.set": {
    schema_version: 1,
    name: "input.set",
    verb: "set",
    noun: "input",
    summary: "Switch the Unity Input System handler (legacy / new / both). Lifecycle-aware.",
    when: [
      "Migrating a project to the New Input System.",
      "Switching for platform-specific testing.",
    ],
    when_not: [
      "During an active editor session without --restart — triggers heavy reload that may crash editor (issue #6).",
      "Mid-build — settings changes after build start are ignored.",
    ],
    args: [
      ...COMMON_ARGS,
      {
        name: "handler",
        type: "enum",
        enumValues: ["legacy", "new", "both"],
        required: true,
        description: "Target input handler",
      },
      {
        name: "restart",
        type: "bool",
        default: false,
        required: false,
        description: "Auto-orchestrate editor close → modify → optional relaunch",
      },
    ],
    examples: [
      { cmd: "unictl input set new --restart", intent: "switch to New Input System with full restart cycle" },
      { cmd: "unictl input set legacy", intent: "revert to legacy Input (editor must be closed first)" },
    ],
    exit_codes: [0, 2, 3, 125],
    related: ["editor.restart", "editor.status", "scripting.set"],
    since_version: SINCE,
    stability: "beta",
  },
  "deploy.android.keystore.set": {
    schema_version: 1,
    name: "deploy.android.keystore.set",
    verb: "set",
    noun: "deploy.android.keystore",
    summary: "Configure Android keystore path + alias in ProjectSettings.asset and enable custom keystore. Passwords NOT persisted (supply at build time via UNITY_ANDROID_KEYSTORE_PASS / UNITY_ANDROID_KEYALIAS_PASS env vars).",
    when: [
      "Setting up signing for a release Android build.",
      "Migrating keystore configuration to a new project.",
    ],
    when_not: [
      "Storing dev-build keystores — use Unity's default debug keystore.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "path", type: "path", required: true, description: "Keystore file path (relative to project root or absolute)" },
      { name: "alias", type: "string", required: true, description: "Key alias" },
    ],
    examples: [
      { cmd: "unictl deploy android keystore set --path Build/release.keystore --alias release", intent: "configure release signing (path/alias only; passwords supplied at build time via env)" },
    ],
    exit_codes: [0, 2, 3, 125],
    related: ["scripting.set"],
    since_version: SINCE,
    stability: "beta",
  },
  "scripting.set": {
    schema_version: 1,
    name: "scripting.set",
    verb: "set",
    noun: "scripting",
    summary: "Toggle scripting backend (mono / il2cpp) per platform.",
    when: [
      "Preparing a release IL2CPP build for iOS/Android.",
      "Reverting to Mono for faster iteration.",
    ],
    when_not: [
      "Editor is running and you cannot afford a domain reload — switch with editor closed.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "backend", type: "enum", enumValues: ["mono", "il2cpp"], required: true, description: "Target scripting backend" },
      { name: "platform", type: "string", required: true, description: "Target platform (android, ios, standalone, ...)" },
    ],
    examples: [
      { cmd: "unictl scripting set il2cpp --platform android", intent: "switch Android to IL2CPP" },
      { cmd: "unictl scripting set mono --platform standalone", intent: "switch desktop player to Mono" },
    ],
    exit_codes: [0, 2, 3, 125],
    related: ["deploy.android.keystore.set"],
    since_version: SINCE,
    stability: "beta",
  },
  "settings.raw-set": {
    schema_version: 1,
    name: "settings.raw-set",
    verb: "raw-set",
    noun: "settings",
    summary: "Escape hatch: edit a Unity project setting by raw key. NO WARRANTY — bypasses Unity setter side effects.",
    when: [
      "An unsupported setting needs to be tweaked and there's no feature bundle for it.",
    ],
    when_not: [
      "A feature bundle exists (input set, deploy keystore set, scripting set, ...) — use it instead.",
      "Without --no-warranty — the command refuses without that flag.",
      "Settings that trigger Unity side effects (InputSystem activation, IL2CPP install, ...) — those need the proper setter, not raw YAML.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "key", type: "string", required: true, description: "Setting key path (e.g. m_ActiveInputHandler)" },
      { name: "value", type: "string", required: true, description: "New value (string-typed)" },
      { name: "no-warranty", type: "bool", default: false, required: true, description: "Required acknowledgment that raw edits bypass setter side effects" },
    ],
    examples: [
      { cmd: "unictl settings raw-set companyName Tinycell --no-warranty", intent: "edit a top-level scalar (e.g. companyName)" },
    ],
    exit_codes: [0, 2, 3, 125],
    related: ["input.set", "scripting.set"],
    since_version: SINCE,
    stability: "beta",
  },
  "wait": {
    schema_version: 1,
    name: "wait",
    verb: "wait",
    noun: "",
    summary: "Block until the editor reaches the given state (idle | playing | compiling | reloading | reachable).",
    when: [
      "Sequencing automation that depends on editor state transitions.",
      "Replacing sleep+retry loops with a deterministic wait.",
    ],
    when_not: [
      "You need a one-shot status check — use 'unictl editor status' instead.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "state", type: "enum", enumValues: ["idle", "playing", "compiling", "reloading", "reachable"], required: true, description: "Target editor state" },
      { name: "timeout", type: "duration", default: "auto", required: false, description: "Max wait time (e.g. 30s, 2m, 0 for unbounded). Default per F.3 matrix." },
    ],
    examples: [
      { cmd: "unictl editor compile --wait idle --timeout 90s", intent: "trigger compile and wait for idle" },
      { cmd: "unictl wait reachable --timeout 5s", intent: "fast pipe-responsiveness probe" },
    ],
    exit_codes: [0, 2, 3, 124, 125, 130],
    related: ["editor.status", "editor.compile", "editor.play"],
    since_version: SINCE,
    stability: "beta",
  },
};

/**
 * Look up describe metadata by canonical name. Returns null if unknown.
 */
export function lookupDescribe(name: string): DescribeMetadata | null {
  return v07Describes[name] ?? null;
}

/**
 * Aggregator: emit every v0.7 verb describe as one JSON document. Used by
 * `unictl list --describe-all` (added in C-mapping sub-PR or later).
 */
export function describeAll(): { schema_version: 1; commands: DescribeMetadata[] } {
  return {
    schema_version: 1,
    commands: Object.values(v07Describes),
  };
}
