// Machine-readable command contract schema + registry.
//
// `unictl schema` is the canonical agent metadata channel. Human help output
// routes agents here, but the schema command is the only stable surface for
// flags, risks, examples, exit codes, and command stability.

import { getCliPackageMeta } from "./meta";

export interface CommandSchemaArg {
  name: string;
  type: "string" | "int" | "bool" | "enum" | "path" | "duration" | "positional";
  enumValues?: readonly string[];
  default?: string | number | boolean;
  required: boolean;
  description: string;
}

export interface CommandSchemaExample {
  cmd: string;
  intent: string;
}

export interface CommandSchema {
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
  args: readonly CommandSchemaArg[];
  examples: readonly CommandSchemaExample[];
  exit_codes: readonly number[];
  /** Related command names (matches `name` field in their schema) */
  related: readonly string[];
  since_version: string;
  stability: "stable" | "beta" | "experimental";
}

const SINCE = "0.7.0";
const COMMON_ARGS: readonly CommandSchemaArg[] = [
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
];

/**
 * Phase F: editor sub-verbs accept --wait <state> + --timeout <dur> on top
 * of COMMON_ARGS. State is optional — omitting it uses the verb-specific
 * F.3 default (compile/refresh/stop → idle, play → playing).
 */
const EDITOR_WAIT_ARGS: readonly CommandSchemaArg[] = [
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

export const commandSchemas: Record<string, CommandSchema> = {
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
      { cmd: "unictl editor compile --wait idle --timeout 90s", intent: "trigger compile, block until editor returns to idle, and inspect compile_lifecycle.compile_observed/result_confidence" },
      { cmd: "unictl editor compile --no-json", intent: "human-readable output" },
      { cmd: "unictl editor compile --wait idle", intent: "if error.kind=editor_compile_error_state, fix error.context.compile_errors before retrying editor workflows" },
      { cmd: "unictl editor compile --wait idle", intent: "if error.kind=unictl_upm_too_old or unictl_cli_too_old, follow error.context.recommended_commands before retrying" },
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
      { cmd: "unictl editor refresh --wait idle", intent: "if error.kind=editor_compile_error_state, fix error.context.compile_errors before investigating IPC or package failures" },
    ],
    exit_codes: [0, 2, 3, 124, 125, 130],
    related: ["editor.compile", "editor.status", "wait"],
    since_version: SINCE,
    stability: "beta",
  },
  "editor.status": {
    schema_version: 1,
    name: "editor.status",
    verb: "status",
    noun: "editor",
    summary: "Report Unity editor process, IPC reachability, and rich ready-state snapshot fields.",
    when: [
      "Checking current editor process and IPC health before sending live-editor commands.",
      "Diagnosing project/pipe mismatches.",
      "Agents need one machine-readable snapshot for compiling, reloading, Play Mode, heartbeat, and domain reload state.",
    ],
    when_not: [
      "You need to wait for a future state transition — use `unictl wait <state>`.",
      "You are considering raw `command editor_control -p action=status` — prefer this first-class command.",
    ],
    args: [...COMMON_ARGS],
    examples: [
      { cmd: "unictl editor status --project D:/workspace/unity/MyProject", intent: "check editor process, IPC reachability, and ready-state fields" },
    ],
    exit_codes: [0, 1],
    related: ["health", "wait"],
    since_version: "0.1.0",
    stability: "stable",
  },
  "editor.open": {
    schema_version: 1,
    name: "editor.open",
    verb: "open",
    noun: "editor",
    summary: "Open the Unity editor with project-scoped logs and optionally wait for a target state.",
    when: [
      "Starting a project editor session for live IPC commands and project-scoped editor logs.",
      "Agent automation needs a ready-sync signal before sending editor-lane commands.",
    ],
    when_not: [
      "You only need a headless compile — use `unictl compile`.",
      "The editor is already running and you do not need a ready-sync check — use `unictl editor status`.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "skip-precompile", type: "bool", default: false, required: false, description: "Skip the batchmode precompile check before opening the editor." },
      { name: "wait", type: "enum", enumValues: ["idle", "playing", "compiling", "reloading", "reachable"], required: false, description: "Wait for editor state after spawn. Bare --wait defaults to reachable." },
      { name: "timeout", type: "duration", default: "auto", required: false, description: "Wait timeout (e.g. 30s, 2m, 0 unbounded)." },
    ],
    examples: [
      { cmd: "unictl editor open --wait reachable --timeout 300s", intent: "open editor, create Library/unictl-state/editor-current.log, and wait until IPC handler is registered" },
      { cmd: "unictl editor open --skip-precompile", intent: "open without the batchmode precompile guard" },
    ],
    exit_codes: [0, 1, 2, 3, 124, 125],
    related: ["editor.status", "wait", "health"],
    since_version: "0.1.0",
    stability: "stable",
  },
  "editor.quit": {
    schema_version: 1,
    name: "editor.quit",
    verb: "quit",
    noun: "editor",
    summary: "Quit the Unity editor gracefully, with optional timeout before force fallback.",
    when: [
      "Closing a live editor before ProjectSettings mutations or batchmode work.",
      "Cleaning up a sandbox smoke test editor session.",
    ],
    when_not: [
      "A build or test job is currently running unless the caller intentionally aborts that session.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "force", type: "bool", default: false, required: false, description: "Allow force kill if graceful quit does not complete." },
      { name: "timeout", type: "duration", default: "15s", required: false, description: "Graceful quit ceiling before fallback." },
    ],
    examples: [
      { cmd: "unictl editor quit --timeout 30s", intent: "gracefully close the editor and wait for PID exit" },
    ],
    exit_codes: [0, 1, 2, 3],
    related: ["editor.open", "editor.status"],
    since_version: "0.1.0",
    stability: "stable",
  },
  "editor.restart": {
    schema_version: 1,
    name: "editor.restart",
    verb: "restart",
    noun: "editor",
    summary: "Restart the Unity editor by quitting and opening it again.",
    when: [
      "Applying lifecycle changes that require a full editor restart.",
      "Recovering a live editor session after package import or settings changes.",
    ],
    when_not: [
      "You only need a script recompile — use `unictl editor compile`.",
      "The editor is running a long build or test job.",
    ],
    args: [...COMMON_ARGS],
    examples: [
      { cmd: "unictl editor restart --project D:/workspace/unity/MyProject", intent: "close and reopen the project editor" },
    ],
    exit_codes: [0, 1, 2, 3, 125],
    related: ["editor.quit", "editor.open", "editor.status"],
    since_version: "0.1.0",
    stability: "stable",
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
        description: "Close the editor before modifying ProjectSettings.asset. Does not relaunch.",
      },
    ],
    examples: [
      { cmd: "unictl input set new --restart", intent: "close the editor, then switch to New Input System" },
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
  "command": {
    schema_version: 1,
    name: "command",
    verb: "command",
    noun: "",
    summary: "Canonical dispatcher for `[UnictlTool]` registrations (builtin tools without a v0.7 verb-noun host AND all consumer-defined tools). Permanent — not deprecated, not removed in v1.0.",
    when: [
      "Invoking a builtin tool that has no v0.7 verb-noun equivalent yet (capture_ui, editor_log, execute_menu, ping, ugui_input, ui_toolkit_input, build_status, build_cancel, editor_control action=load_scene).",
      "Invoking a consumer project's own `[UnictlTool]` C# registration.",
      "Enumerating all installed `[UnictlTool]` registrations at runtime via `unictl command list`.",
    ],
    when_not: [
      "A v0.7 verb-noun equivalent exists (editor.compile/play/stop/refresh, input.set, scripting.set, deploy.android.keystore.set, settings.raw-set, wait, schema). Prefer the verb-noun form — v1.0 hard-removes those specific `command <tool>` invocation patterns even though the dispatcher itself stays.",
      "You only need static (offline) discovery of v0.7 verbs — use `unictl schema` instead, which returns metadata without an editor running.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "tool", type: "string", required: false, description: "UnictlTool name (e.g. editor_log, capture_ui, my_custom_tool). Omit to enumerate all tools." },
      { name: "p", type: "string", required: false, description: "Parameter as key=value, repeatable (e.g. -p action=tail -p lines=50)." },
      { name: "format", type: "enum", enumValues: ["json", "text"], default: "json", required: false, description: "Output format. text is currently specialized for editor_log and emits raw lines/matches/errors for shell pipes." },
    ],
    examples: [
      { cmd: "unictl command list", intent: "enumerate all [UnictlTool] registrations at runtime (builtin + consumer-defined)" },
      { cmd: "unictl command editor_log -p action=errors", intent: "read compile errors / exceptions from the project-scoped editor log; if editor_log IPC fails, the CLI may fall back to Library/unictl-state/editor-current.log with data.fallback_kind=cli_project_log_file" },
      { cmd: "unictl command editor_control -p action=status", intent: "diagnose editor and CLI/UPM version compatibility without triggering a workflow" },
      { cmd: "unictl command editor_log -p action=tail --format text", intent: "print raw log lines for shell pipelines such as grep, tail, or wc" },
      { cmd: "unictl command capture_ui -p mode=screenshot", intent: "invoke a builtin without a v0.7 verb-noun host" },
      { cmd: "unictl command my_save_inspector -p target=Player", intent: "invoke a consumer-defined [UnictlTool]" },
      { cmd: "unictl schema command", intent: "emit this command contract as JSON" },
    ],
    exit_codes: [0, 1, 2, 3, 124, 125],
    related: ["schema", "doctor", "health"],
    since_version: "0.1.0",
    stability: "stable",
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
      { cmd: "unictl wait idle", intent: "if error.kind=editor_compile_error_state, fix error.context.compile_errors before retrying editor-side workflows" },
    ],
    exit_codes: [0, 2, 3, 124, 125, 130],
    related: ["editor.status", "editor.compile", "editor.play"],
    since_version: SINCE,
    stability: "beta",
  },
  "build": {
    schema_version: 1,
    name: "build",
    verb: "build",
    noun: "",
    summary: "Build a Unity player and expose an agent-friendly lifecycle status stream.",
    when: [
      "Building a Unity player from an agent or CI workflow.",
      "You need queued/running/succeeded/failed/cancelled lifecycle states without parsing progress files.",
      "You want unictl to auto-route between a live editor IPC build and headless batchmode.",
      "You are invoking a project-specific build wrapper and can report terminal status with UnictlBuildContext.",
    ],
    when_not: [
      "You only need to check C# compilation — use `unictl compile` or `unictl editor compile`.",
      "You need a consumer-defined runtime tool unrelated to building — use `unictl command <tool>`.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "target", type: "string", required: false, description: "Unity BuildTarget, e.g. StandaloneWindows64, Android, iOS, WebGL." },
      { name: "output", type: "path", required: false, description: "Output path. Defaults to a target/product-name path under Build/." },
      { name: "scenes", type: "string", required: false, description: "Comma-separated scene asset paths. Defaults to enabled EditorBuildSettings scenes." },
      { name: "define", type: "string", required: false, description: "Comma-separated scripting define symbols." },
      { name: "build-profile", type: "path", required: false, description: "Unity 6+ BuildProfile asset path. Requires batchmode." },
      { name: "development", type: "bool", default: false, required: false, description: "Enable Development Build." },
      { name: "allow-debugging", type: "bool", default: false, required: false, description: "Allow script debugging." },
      { name: "wait", type: "bool", default: true, required: false, description: "Wait until a terminal lifecycle state and stream state transitions." },
      { name: "timeout", type: "duration", default: "0", required: false, description: "Client wait timeout; 0 means unlimited. Timeout exits 124 while the build continues." },
      { name: "batch", type: "bool", default: false, required: false, description: "Force headless batchmode lane. Fails if the editor is running." },
      { name: "force-ipc", type: "bool", default: false, required: false, description: "Force live editor IPC lane. Fails if the editor is not running." },
      { name: "job-id", type: "string", required: false, description: "Caller-provided job identifier for lifecycle polling." },
      { name: "method", type: "string", required: false, description: "Project static build method to invoke, e.g. Namespace.Type.Method. Prefer Method(UnictlBuildContext ctx) and call scope.Complete(report), scope.Fail(...), or throw for reliable status." },
      { name: "method-param", type: "string", required: false, description: "Custom build method parameter as key=value. May be repeated." },
      { name: "method-params-json", type: "path", required: false, description: "Path to a JSON object with custom build method parameters." },
      { name: "min-expected-duration-ms", type: "int", default: 5000, required: false, description: "Suspicious fast-return threshold for custom methods without terminal context report; 0 disables." },
    ],
    examples: [
      { cmd: "unictl build --target StandaloneWindows64 --wait", intent: "start a build and stream normalized lifecycle states until terminal" },
      { cmd: "unictl build --target Android --build-profile Assets/Profiles/Android-Release.asset --batch --timeout 3600", intent: "run a Unity 6 BuildProfile build in batchmode" },
      { cmd: "unictl build --target iOS --batch --output Build/iOS --job-id ci-abc123 --no-wait", intent: "schedule a build and use the returned status_command for polling" },
      { cmd: "unictl build --method PickUpCatBuild.Android --method-param channel=release --wait", intent: "invoke a project-defined custom static build method; prefer Method(UnictlBuildContext ctx) so the method reports Complete/Fail rather than relying on void return" },
    ],
    exit_codes: [0, 1, 2, 3, 124, 125],
    related: ["build.status", "build.cancel", "command", "editor.status", "wait"],
    since_version: "0.4.0",
    stability: "beta",
  },
  "build.status": {
    schema_version: 1,
    name: "build.status",
    verb: "status",
    noun: "build",
    summary: "Read normalized lifecycle status for an existing build job.",
    when: [
      "You have a job_id from `unictl build --no-wait` or a timeout response.",
      "Polling a long-running build until terminal=true.",
      "You need normalized lifecycle fields without parsing Library/unictl-builds manually.",
    ],
    when_not: [
      "You have not started a build and do not have a job_id.",
      "You want to start a new build — use `unictl build`.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "job-id", type: "string", required: true, description: "Build job id returned by `unictl build`." },
    ],
    examples: [
      { cmd: "unictl build status --job-id ci-abc123", intent: "read current lifecycle status for a build" },
      { cmd: "unictl build status --job-id ci-abc123 --project D:/workspace/unity/MyProject", intent: "poll a specific Unity project" },
    ],
    exit_codes: [0, 2, 125],
    related: ["build", "build.cancel"],
    since_version: "0.7.11",
    stability: "beta",
  },
  "build.cancel": {
    schema_version: 1,
    name: "build.cancel",
    verb: "cancel",
    noun: "build",
    summary: "Request cooperative cancellation for a queued build job.",
    when: [
      "A build was scheduled but should be cancelled before Unity BuildPipeline starts.",
      "You have a job_id and the build is still queued in a live editor IPC lane.",
    ],
    when_not: [
      "The build is already running inside BuildPipeline.BuildPlayer — Unity has no safe interrupt API.",
      "The editor IPC session is not reachable — use `unictl build status --job-id <id>` to inspect instead.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "job-id", type: "string", required: true, description: "Build job id returned by `unictl build`." },
    ],
    examples: [
      { cmd: "unictl build cancel --job-id ci-abc123", intent: "cancel a queued editor-lane build" },
      { cmd: "unictl build status --job-id ci-abc123", intent: "check status after a cancel request" },
    ],
    exit_codes: [0, 1, 2, 3, 125],
    related: ["build", "build.status"],
    since_version: "0.7.11",
    stability: "beta",
  },
  "test": {
    schema_version: 1,
    name: "test",
    verb: "test",
    noun: "",
    summary: "Run Unity tests via editor lane when reachable, otherwise batchmode.",
    when: [
      "Running EditMode or PlayMode tests from an agent or CI workflow.",
      "You want unictl to handle editor-lane completion detection instead of parsing raw test_run progress files.",
      "You want one command to auto-route: live editor uses editor lane; no editor uses batchmode.",
    ],
    when_not: [
      "You already started a raw editor-lane test_run job and only need to wait for it — use `unictl test wait <job-id>`.",
      "You need to invoke a custom consumer-defined test tool — use `unictl command <tool>`.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "batch", type: "bool", default: false, required: false, description: "Force batchmode lane. Fails if the editor is already running." },
      { name: "platform", type: "enum", enumValues: ["editmode", "playmode"], required: true, description: "Unity test platform." },
      { name: "results", type: "path", required: true, description: "Output NUnit XML path. This is the source of truth for test failures and thrown test exceptions. Must not be under the Unity project Temp directory." },
      { name: "filter", type: "string", required: false, description: "Unity -testFilter expression, or assembly:<AssemblyName>." },
      { name: "timeout", type: "duration", required: false, description: "Wall-clock timeout (30s, 2m, 1h, bare seconds, or 0 unlimited)." },
      { name: "allow-unsaved-scenes", type: "bool", default: false, required: false, description: "Editor lane: bypass dirty-scene preflight check for PlayMode." },
      { name: "allow-reload-active", type: "bool", default: false, required: false, description: "Editor lane: attempt PlayMode tests with full domain reload enabled." },
    ],
    examples: [
      { cmd: "unictl test --platform editmode --results TestResults/results.xml", intent: "run EditMode tests using the live editor if reachable, otherwise batchmode; inspect results_file for failures and log_file for Unity logs" },
      { cmd: "unictl test --batch --platform editmode --filter assembly:MyTests --results TestResults/editmode.xml --timeout 5m", intent: "force headless EditMode tests with an assembly filter" },
    ],
    exit_codes: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    related: ["test.wait", "editor.status", "wait"],
    since_version: "0.6.0",
    stability: "stable",
  },
  "test.wait": {
    schema_version: 1,
    name: "test.wait",
    verb: "wait",
    noun: "test",
    summary: "Wait for an existing editor-lane test_run job; does not start tests.",
    when: [
      "You already have a job_id from raw `unictl command test_run` and need reliable completion detection.",
      "Replacing progress-file grep with BOM-safe JSON parsing, session checks, PID checks, timeout handling, and terminal state mapping.",
    ],
    when_not: [
      "You have not started a raw test_run job — prefer `unictl test`, which starts and waits in one command.",
      "You need a generic editor state wait — use `unictl wait <state>`.",
    ],
    args: [
      ...COMMON_ARGS,
      { name: "job-id", type: "positional", required: true, description: "Existing editor-lane test_run job_id." },
      { name: "timeout", type: "duration", required: false, description: "Wall-clock timeout (30s, 2m, 1h, bare seconds, or 0 unlimited)." },
      { name: "progress-file", type: "path", required: false, description: "Optional explicit progress JSON path. Default: Library/unictl-tests/<job-id>.json." },
    ],
    examples: [
      { cmd: "unictl test wait 9b45e23a-1f20-4208-9a9f-34d76b7d0968 --project D:/workspace/unity/MyProject --timeout 2m", intent: "wait for a raw editor-lane test_run job to finish" },
    ],
    exit_codes: [0, 1, 2, 6, 8],
    related: ["test", "command"],
    since_version: "0.7.8",
    stability: "beta",
  },
  "schema": {
    schema_version: 1,
    name: "schema",
    verb: "schema",
    noun: "",
    summary: "Emit machine-readable command contracts for agents and automation.",
    when: [
      "Before scripting a unictl command or changing automation that calls unictl.",
      "When an agent needs flags, risk conditions, examples, exit codes, or stability without parsing human help.",
    ],
    when_not: [
      "You need human-oriented usage text — use `unictl --help` or `unictl <command> --help`.",
    ],
    args: [
      { name: "command", type: "positional", required: false, description: "Canonical command name such as editor.open, editor.compile, input.set. Omit for all commands." },
    ],
    examples: [
      { cmd: "unictl schema", intent: "emit all command contracts" },
      { cmd: "unictl schema input.set", intent: "inspect the input settings lifecycle contract" },
    ],
    exit_codes: [0, 2],
    related: ["capabilities"],
    since_version: "0.7.8",
    stability: "beta",
  },
};

/**
 * Look up command schema by canonical name. Returns null if unknown.
 */
export function lookupCommandSchema(name: string): CommandSchema | null {
  return commandSchemas[name] ?? null;
}

/**
 * Aggregator: emit every v0.7 command contract as one JSON document.
 */
export function schemaAll(): { schema_version: 1; unictl_version: string; commands: CommandSchema[] } {
  return {
    schema_version: 1,
    unictl_version: getCliPackageMeta().version,
    commands: Object.values(commandSchemas),
  };
}
