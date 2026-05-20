#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { readFileSync } from "fs";
import caps from "./capabilities.json" assert { type: "json" };
import { command, health } from "./client";
import { formatHelpJson } from "./help-json";
import { lookupHintCommand } from "./error";
import { buildCmd, runBuildCancelCli, runBuildStatusCli } from "./build";
import { runCompile } from "./compile";
import { runTestWaitCli, testCmd } from "./test";
import { editorStatus, editorQuit, editorOpen, editorRestart } from "./editor";
import { v07EditorSubCommands, v07TopLevelCommands } from "./v07-commands";
import { schemaAll, lookupCommandSchema } from "./schema";
import {
  WAIT_STATES,
  type WaitState,
  parseDuration,
  lookupTimeoutDefault,
  runWait,
  outcomeToEnvelope,
} from "./wait";
import { getCliPackageMeta, getEmbeddedEditorPackageVersion, getRepoUrl } from "./meta";
import {
  buildGitPackageReference,
  getManifestPath,
  parsePackageReference,
  readProjectManifest,
  writeProjectManifest,
  type UnityManifest,
} from "./project";
import {
  findProjectRoot,
  hasEndpointFile,
  readEndpointDescriptor,
} from "./socket";

type DoctorSeverity = "error" | "warn" | "info";

type DoctorCheck = {
  name: string;
  ok: boolean;
  severity: DoctorSeverity;
  detail: string;
  data?: unknown;
};

function output(data: unknown): void {
  console.log(JSON.stringify(data));
}

function outputErrorAndExit(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  output({ error: message });
  process.exit(1);
}

/**
 * -p key=value 인자들을 파싱하여 객체로 반환.
 */
function parsePFlags(args: string[]): Record<string, string> | null {
  const result: Record<string, string> = {};
  let found = false;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "-p" || args[i] === "--p") && i + 1 < args.length) {
      const kv = args[i + 1];
      const eq = kv.indexOf("=");
      if (eq > 0) {
        result[kv.slice(0, eq)] = kv.slice(eq + 1);
        found = true;
      }
      i++; // skip value
    }
  }

  return found ? result : null;
}

function emitEditorLogText(response: unknown): boolean {
  if (!response || typeof response !== "object") return false;
  const obj = response as Record<string, unknown>;
  if (obj.success === false) {
    const message = typeof obj.message === "string" ? obj.message : "editor_log failed";
    console.error(message);
    return true;
  }

  const data = obj.data;
  if (!data || typeof data !== "object") return false;
  const payload = data as Record<string, unknown>;

  const lines = payload.lines;
  if (Array.isArray(lines)) {
    for (const line of lines) console.log(String(line));
    return true;
  }

  const matches = payload.matches;
  if (Array.isArray(matches)) {
    for (const match of matches) {
      if (match && typeof match === "object" && "text" in match) {
        console.log(String((match as { text: unknown }).text));
      }
    }
    return true;
  }

  const compileErrors = Array.isArray(payload.compile_errors) ? payload.compile_errors : [];
  const exceptions = Array.isArray(payload.exceptions) ? payload.exceptions : [];
  if ("compile_errors" in payload || "exceptions" in payload) {
    const emitEntries = (entries: unknown[]) => {
      for (const entry of entries) {
        if (entry && typeof entry === "object" && "text" in entry) {
          console.log(String((entry as { text: unknown }).text));
        }
      }
    };
    emitEntries(compileErrors);
    if (compileErrors.length > 0 && exceptions.length > 0) console.log("");
    emitEntries(exceptions);
    return true;
  }

  return false;
}

/**
 * @file 인자에서 JSON 파일 경로를 추출.
 */
function parseFileArg(args: string[]): Record<string, unknown> | null {
  for (const arg of args) {
    if (arg.startsWith("@")) {
      const filePath = arg.slice(1);
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content);
    }
  }
  return null;
}

/**
 * stdin에서 JSON을 읽는다 (non-TTY일 때만).
 */
async function readStdin(): Promise<Record<string, unknown> | null> {
  if (process.stdin.isTTY) return null;

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf-8").trim();
  if (!text) return null;

  return JSON.parse(text);
}

/**
 * 파라미터를 우선순위에 따라 결정: -p > @file > stdin
 */
async function resolveParams(rawArgs: string[]): Promise<Record<string, unknown> | undefined> {
  const pFlags = parsePFlags(rawArgs);
  if (pFlags) return pFlags;

  const fileParams = parseFileArg(rawArgs);
  if (fileParams) return fileParams;

  const stdinParams = await readStdin();
  if (stdinParams) return stdinParams;

  return undefined;
}

function getVersionInfo(): Record<string, unknown> {
  const cliPackage = getCliPackageMeta();
  return {
    success: true,
    message: "unictl version info",
    data: {
      package_name: cliPackage.name,
      cli_version: cliPackage.version,
      package_json_path: cliPackage.packageJsonPath,
      embedded_editor_version: getEmbeddedEditorPackageVersion(),
      runtime: "bun",
    },
  };
}

function createCheck(
  name: string,
  ok: boolean,
  severity: DoctorSeverity,
  detail: string,
  data?: unknown
): DoctorCheck {
  return { name, ok, severity, detail, data };
}

function summarizeDoctorChecks(checks: DoctorCheck[]): { success: boolean; warnings: number } {
  const failedErrors = checks.filter((check) => check.severity === "error" && !check.ok);
  const warnings = checks.filter((check) => check.severity === "warn" && !check.ok).length;
  return {
    success: failedErrors.length === 0,
    warnings,
  };
}

async function runDoctor(projectPath?: string): Promise<Record<string, unknown>> {
  const cliPackage = getCliPackageMeta();
  const checks: DoctorCheck[] = [];
  let dominantErrorKind: string | null = null;

  let projectRoot: string | null = null;
  try {
    projectRoot = projectPath ? projectPath : findProjectRoot();
    if (!projectRoot) {
      checks.push(createCheck("project_root", false, "error", "Unity project root could not be detected."));
      dominantErrorKind = "project_not_detected";
    } else {
      checks.push(createCheck("project_root", true, "info", "Unity project root detected.", { project_root: projectRoot }));
    }
  } catch (error) {
    checks.push(createCheck("project_root", false, "error", error instanceof Error ? error.message : String(error)));
    dominantErrorKind = "project_not_detected";
  }

  if (projectRoot) {
    try {
      const manifestPath = getManifestPath(projectRoot);
      const manifest = readProjectManifest(projectRoot);
      checks.push(createCheck("manifest", true, "info", "Unity manifest loaded.", { manifest_path: manifestPath }));

      const dependencyRef = manifest.dependencies?.["com.unictl.editor"];
      if (!dependencyRef) {
        checks.push(createCheck("editor_package_dependency", false, "error", "`com.unictl.editor` dependency is missing from manifest.json."));
      } else {
        const parsedReference = parsePackageReference(dependencyRef, projectRoot);
        checks.push(createCheck("editor_package_dependency", true, "info", "`com.unictl.editor` dependency is present.", parsedReference));

        if (parsedReference.version) {
          const matchesCliVersion = parsedReference.version === cliPackage.version;
          checks.push(createCheck(
            "version_alignment",
            matchesCliVersion,
            matchesCliVersion ? "info" : "error",
            matchesCliVersion
              ? "CLI version and editor package version align."
              : `CLI version ${cliPackage.version} does not match editor package version ${parsedReference.version}.`,
            {
              cli_version: cliPackage.version,
              editor_package_version: parsedReference.version,
            }
          ));
        } else {
          checks.push(createCheck(
            "version_alignment",
            false,
            "warn",
            "Editor package reference is opaque, so exact version drift could not be verified.",
            { reference: dependencyRef }
          ));
        }
      }
    } catch (error) {
      checks.push(createCheck(
        "manifest",
        false,
        "error",
        error instanceof Error ? error.message : String(error)
      ));
    }

    const endpointFile = hasEndpointFile(projectRoot);
    if (!endpointFile) {
      checks.push(createCheck("endpoint_file", false, "warn", "No `.unictl/endpoint.json` file found. Editor may not be running yet."));
    } else {
      const endpoint = readEndpointDescriptor(projectRoot);
      if (!endpoint) {
        checks.push(createCheck("endpoint_descriptor", false, "error", "Endpoint file exists but could not be parsed."));
      } else {
        checks.push(createCheck("endpoint_descriptor", true, "info", "Endpoint descriptor loaded.", endpoint));
      }
    }

    const status = await editorStatus({ project: projectRoot });
    if (!status.running) {
      checks.push(createCheck("editor_status", false, "warn", "Unity editor is not running for this project."));
    } else {
      checks.push(createCheck("editor_status", true, "info", "Unity editor process is running.", { pid: status.pid }));
    }

    if (status.running && status.health == null) {
      checks.push(createCheck("health_probe", false, "error", "Editor is running but `/health` did not respond successfully.", {
        transport: status.transport,
        endpoint: status.endpoint,
      }));
      if (!dominantErrorKind) dominantErrorKind = "ipc_error";
    } else if (status.health != null) {
      checks.push(createCheck("health_probe", true, "info", "Health probe succeeded.", status.health));
    } else {
      checks.push(createCheck("health_probe", false, "warn", "Health probe skipped because editor is not currently reachable."));
    }
  }

  const summary = summarizeDoctorChecks(checks);
  const result: Record<string, unknown> = {
    ok: summary.success,
    success: summary.success,
    message: summary.success ? "Doctor checks passed." : "Doctor found blocking issues.",
    data: {
      cli_version: cliPackage.version,
      warnings: summary.warnings,
      checks,
    },
  };
  if (!summary.success && dominantErrorKind) {
    result.error = { kind: dominantErrorKind };
  }
  return result;
}

function ensureDependencies(manifest: UnityManifest): Record<string, string> {
  if (!manifest.dependencies) {
    manifest.dependencies = {};
  }

  return manifest.dependencies;
}

function resolveInitReference(args: {
  repoUrl?: string;
  packageRef?: string;
  version?: string;
  head?: boolean;
}): { reference: string; source: string } {
  if (args.packageRef) {
    return { reference: args.packageRef, source: "explicit-package-ref" };
  }

  // Resolve repo URL: explicit --repo-url > package.json repository
  const repoUrl = args.repoUrl ?? getRepoUrl();

  if (repoUrl) {
    // --head → no tag (HEAD), default → pin to CLI version tag
    const version = args.head ? undefined : (args.version ?? getCliPackageMeta().version);
    return {
      reference: buildGitPackageReference(repoUrl, version),
      source: args.repoUrl ? "repo-url" : "package-json-repository",
    };
  }

  throw new Error(
    "Could not resolve package reference. The CLI package is missing a `repository` field; pass --repoUrl or --packageRef explicitly."
  );
}

function runInit(args: {
  project?: string;
  repoUrl?: string;
  packageRef?: string;
  version?: string;
  head?: boolean;
  dryRun?: boolean;
  force?: boolean;
}): Record<string, unknown> {
  const projectRoot = args.project ? args.project : findProjectRoot();
  if (!projectRoot) {
    throw new Error("Unity project root could not be detected for init.");
  }

  const manifest = readProjectManifest(projectRoot);
  const dependencies = ensureDependencies(manifest);
  const currentReference = dependencies["com.unictl.editor"] ?? null;
  const desired = resolveInitReference(args);

  if (currentReference === desired.reference) {
    return {
      success: true,
      message: "Manifest already contains the desired `com.unictl.editor` reference.",
      data: {
        changed: false,
        dry_run: Boolean(args.dryRun),
        manifest_path: getManifestPath(projectRoot),
        reference: desired.reference,
        reference_source: desired.source,
        next_steps: [
          "If the Unity Editor is closed, run `unictl compile --project <project>` to force Unity package resolve and compile.",
          "If the Unity Editor is open, use Unity Package Manager refresh/re-resolve or restart the editor; pre-install live refresh is not guaranteed.",
        ],
      },
    };
  }

  if (currentReference && currentReference !== desired.reference && !args.force) {
    return {
      success: false,
      message: "Existing `com.unictl.editor` reference differs. Re-run with `--force` to replace it.",
      data: {
        changed: false,
        dry_run: Boolean(args.dryRun),
        manifest_path: getManifestPath(projectRoot),
        current_reference: currentReference,
        desired_reference: desired.reference,
        reference_source: desired.source,
        next_steps: [
          "Review the existing reference before replacing it.",
          "Use `--force` only when you intentionally want to update the manifest entry.",
        ],
      },
    };
  }

  const nextManifest: UnityManifest = {
    ...manifest,
    dependencies: {
      ...dependencies,
      "com.unictl.editor": desired.reference,
    },
  };

  if (!args.dryRun) {
    writeProjectManifest(projectRoot, nextManifest);
  }

  return {
    success: true,
    message: args.dryRun ? "Manifest update planned." : "Manifest updated.",
    data: {
      changed: true,
      dry_run: Boolean(args.dryRun),
      forced: Boolean(args.force),
      manifest_path: getManifestPath(projectRoot),
      previous_reference: currentReference,
      next_reference: desired.reference,
      reference_source: desired.source,
      next_steps: [
        "If the Unity Editor is closed, run `unictl compile --project <project>` to force Unity package resolve and compile.",
        "If the Unity Editor is open, Unity may not immediately notice this external manifest edit; use Package Manager refresh/re-resolve or restart the editor.",
        "`unictl` IPC commands become available only after `com.unictl.editor` has been imported and compiled.",
      ],
    },
  };
}

function normalizeKnownFlags(args: string[]): string[] {
  return args.map((arg) => {
    switch (arg) {
      case "--dry-run":
        return "--dryRun";
      case "--repo-url":
        return "--repoUrl";
      case "--package-ref":
        return "--packageRef";
      case "--skip-precompile":
        return "--skipPrecompile";
      case "--progress-file":
        return "--progressFile";
      default:
        return arg;
    }
  });
}

// ---------------------------------------------------------------------------
// editor subcommands
// ---------------------------------------------------------------------------

const editorStatusCmd = defineCommand({
  meta: { name: "status", description: "Show Unity editor running status" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
  },
  run: async ({ args }) => {
    try {
      output(await editorStatus({ project: args.project }));
    } catch (e: any) {
      const kind = e.kind ?? "ipc_error";
      output({ ok: false, error: { kind, message: e.message, hint_command: lookupHintCommand(kind) } });
      process.exit(1);
    }
  },
});

const editorQuitCmd = defineCommand({
  meta: { name: "quit", description: "Quit the Unity editor" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
    force: {
      type: "boolean",
      description: "Force kill if graceful quit times out",
      default: false,
    },
    timeout: {
      type: "string",
      description: "Graceful quit ceiling before SIGTERM fallback (e.g. 5s, 30s, 1m). Default 15s.",
    },
  },
  run: async ({ args }) => {
    let gracefulTimeoutMs: number | undefined;
    if (typeof args.timeout === "string" && args.timeout.length > 0) {
      const parsed = parseDuration(args.timeout);
      if (Number.isNaN(parsed) || parsed <= 0) {
        output({
          ok: false,
          error: {
            kind: "invalid_param",
            message: `Cannot parse --timeout '${args.timeout}'. Expected forms: 5s, 30s, 1m.`,
            hint_command: lookupHintCommand("invalid_param"),
          },
        });
        process.exit(2);
      }
      gracefulTimeoutMs = parsed * 1000;
    }
    try {
      output(await editorQuit({ project: args.project, force: args.force, gracefulTimeoutMs }));
    } catch (e: any) {
      const kind = e.kind ?? "ipc_error";
      output({ ok: false, error: { kind, message: e.message, hint_command: lookupHintCommand(kind) } });
      process.exit(1);
    }
  },
});

const editorOpenCmd = defineCommand({
  meta: { name: "open", description: "Open the Unity editor (runs pre-compile check first)" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
    skipPrecompile: {
      type: "boolean",
      default: false,
      description: "Skip the batch-mode pre-compile check",
    },
    wait: {
      type: "string",
      description: "After spawn, block until editor reaches the given state (idle | playing | compiling | reloading | reachable). Pass `--wait` alone to use the default state 'reachable'. Omit for fire-and-forget (current behavior).",
    },
    timeout: {
      type: "string",
      description: "Wait timeout (e.g. 30s, 2m, 1h, 0 unbounded). Default per F.3 matrix; for editor.open this falls back to the (any).reachable=120s entry. Use a longer value or 0 for cold-start projects.",
    },
  },
  run: async ({ args, rawArgs }) => {
    // Resolve --wait first. citty's string arg requires a value, so
    // `--wait --timeout 30s` would consume `--timeout` as the wait value.
    // Probe rawArgs to detect the bare `--wait` form and fall back to the
    // verb default state ('reachable' for editor.open per the v0.7 ready-sync
    // contract).
    const waitFlagIdx = rawArgs.indexOf("--wait");
    const waitNext = waitFlagIdx >= 0 ? rawArgs[waitFlagIdx + 1] : undefined;
    const waitNextIsFlag = typeof waitNext === "string" && waitNext.startsWith("--");
    let waitTarget: WaitState | null = null;

    if (waitFlagIdx >= 0 && (waitNext === undefined || waitNextIsFlag)) {
      waitTarget = "reachable";
    } else if (typeof args.wait === "string" && args.wait.length > 0) {
      if (!WAIT_STATES.includes(args.wait as WaitState)) {
        output({
          ok: false,
          error: {
            kind: "invalid_param",
            message: `Unknown wait state '${args.wait}'. Valid: ${WAIT_STATES.join(", ")}.`,
            hint_command: lookupHintCommand("invalid_param"),
          },
        });
        process.exit(2);
      }
      waitTarget = args.wait as WaitState;
    }

    let openResult: unknown;
    let alreadyRunning = false;
    try {
      openResult = await editorOpen({ project: args.project, skipPrecompile: args.skipPrecompile });
    } catch (e: any) {
      const kind = e.kind ?? "ipc_error";
      // With --wait set, treat 'already running' as idempotent ready-sync:
      // skip spawn and proceed to wait. This is the canonical agent ready
      // signal — callers shouldn't have to know whether the editor was up
      // before invoking. All other open errors still abort.
      if (waitTarget !== null && kind === "editor_running") {
        alreadyRunning = true;
        openResult = { opened: false, already_running: true, pid: e.pid ?? null };
      } else {
        output({ ok: false, error: { kind, message: e.message, hint_command: lookupHintCommand(kind) } });
        process.exit(1);
      }
    }

    if (waitTarget === null) {
      // Fire-and-forget — return immediately as before.
      output(openResult);
      return;
    }

    // Already-running + --wait reachable short-circuit: a single /health probe
    // is authoritative for "IPC handler is registered, callers can send
    // commands". Bypass the wait engine here so idempotent ready-sync returns
    // immediately. Cold-starts (alreadyRunning=false) and non-reachable wait
    // targets (idle/playing/etc) still go through the engine.
    if (alreadyRunning && waitTarget === "reachable") {
      const probeStart = Date.now();
      try {
        const h = (await health({ project: args.project })) as { handler_registered?: boolean };
        if (h?.handler_registered === true) {
          output({
            ok: true,
            ...(openResult as Record<string, unknown>),
            wait: {
              state: waitTarget,
              elapsed_ms: Date.now() - probeStart,
              short_circuit: "already_running",
            },
          });
          return;
        }
      } catch {
        // /health unreachable — fall through to wait engine which will poll.
      }
    }

    // Recover --timeout if citty lost it to --wait.
    let timeoutRaw = args.timeout as string | undefined;
    if (timeoutRaw === undefined) {
      const idx = rawArgs.indexOf("--timeout");
      if (idx >= 0 && idx + 1 < rawArgs.length && !rawArgs[idx + 1].startsWith("--")) {
        timeoutRaw = rawArgs[idx + 1];
      }
    }

    let timeoutSeconds: number;
    if (timeoutRaw !== undefined) {
      const parsed = parseDuration(timeoutRaw);
      if (Number.isNaN(parsed)) {
        output({
          ok: false,
          error: {
            kind: "invalid_param",
            message: `Cannot parse --timeout '${timeoutRaw}'. Expected forms: 30s, 2m, 1h, bare integer, or 0.`,
            hint_command: lookupHintCommand("invalid_param"),
          },
        });
        process.exit(2);
      }
      timeoutSeconds = parsed;
    } else {
      timeoutSeconds = lookupTimeoutDefault("editor.open", waitTarget);
    }

    const outcome = await runWait({
      state: waitTarget,
      timeoutSeconds,
      project: args.project,
    });
    const waitEnv = outcomeToEnvelope(outcome);
    if (waitEnv.ok) {
      output({
        ok: true,
        ...(openResult as Record<string, unknown>),
        wait: {
          state: waitEnv.state,
          phase: waitEnv.phase,
          alive_ms_ago: waitEnv.alive_ms_ago,
          elapsed_ms: waitEnv.elapsed_ms,
        },
      });
      return;
    }
    // Wait failed after spawn succeeded — surface both for diagnostics.
    output({
      ok: false,
      ...(openResult as Record<string, unknown>),
      state: waitEnv.state,
      elapsed_ms: waitEnv.elapsed_ms,
      error: waitEnv.error,
    });
    process.exit(waitEnv.error?.exit_code ?? 1);
  },
});

const editorRestartCmd = defineCommand({
  meta: { name: "restart", description: "Restart the Unity editor (quit → clean → open)" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
  },
  run: async ({ args }) => {
    try {
      output(await editorRestart({ project: args.project }));
    } catch (e: any) {
      const kind = e.kind ?? "ipc_error";
      output({ ok: false, error: { kind, message: e.message, hint_command: lookupHintCommand(kind) } });
      process.exit(1);
    }
  },
});

const editorCmd = defineCommand({
  meta: { name: "editor", version: getCliPackageMeta().version, description: "Unity editor process control" },
  subCommands: {
    status: editorStatusCmd,
    quit: editorQuitCmd,
    open: editorOpenCmd,
    restart: editorRestartCmd,
    // v0.7 verb-noun additions (Phase C-skeleton): in-editor IPC actions.
    // Top-level `unictl compile` is batchmode; `unictl editor compile` is in-editor recompile.
    compile: v07EditorSubCommands.compile,
    play: v07EditorSubCommands.play,
    stop: v07EditorSubCommands.stop,
    refresh: v07EditorSubCommands.refresh,
  },
});

const compileCmd = defineCommand({
  meta: {
    name: "compile",
    description: "Run Unity in batchmode to compile + generate .meta files without opening the editor.",
  },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
    timeout: {
      type: "string",
      description: "Timeout in seconds (default: none)",
    },
    logFile: {
      type: "string",
      description: "Custom log file path (default: Temp/unictl-compile-<ts>.log)",
    },
  },
  run: async ({ args }) => {
    try {
      const timeoutSec = args.timeout != null ? Number(args.timeout) : undefined;
      const result = await runCompile({
        project: args.project,
        timeout: timeoutSec,
        logFile: args.logFile,
      });
      if (!result.success) {
        // Spread first so explicit ok/error fields below override result.ok / result.error.
        // Without ordering, result.ok=true (set on line 128 when exitCode!=-1) silently wins.
        const message = result.errors.length > 0
          ? `Compile failed with ${result.errors.length} error(s)`
          : `Unity batchmode exited with code ${result.exit_code} (no compile errors detected; check log_file for cause)`;
        output({
          ...result,
          ok: false,
          error: { kind: "compile_failed", message, hint_command: lookupHintCommand("compile_failed") },
        });
        process.exit(1);
      }
      output({ ok: true, ...result });
    } catch (e: any) {
      const kind: string | undefined = e.kind;
      if (kind === "editor_running" || kind === "project_locked") {
        output({ ok: false, error: { kind, message: e.message, hint_command: lookupHintCommand(kind) } });
        process.exit(3);
      }
      if (kind === "timeout") {
        output({
          ok: false,
          error: { kind: "timeout", message: e.message, hint_command: lookupHintCommand("timeout") },
          duration_ms: e.duration_ms,
          log_file: e.log_file,
        });
        process.exit(124);
      }
      const fallbackKind = kind ?? "ipc_error";
      output({ ok: false, error: { kind: fallbackKind, message: e.message, hint_command: lookupHintCommand(fallbackKind) } });
      process.exit(125);
    }
  },
});

const AGENT_HELP_BANNER = `Agent / automation:
  Machine-readable command contracts:
    unictl schema
    unictl schema <command>

  Prefer first-class commands over raw builtin tools:
    unictl editor status / unictl wait idle
    unictl test

  Do not parse human help output for flags, risks, or exit codes.`;

// v0.6 → v0.7 verb-noun migration hints. When a user invokes a legacy
// `unictl command <tool> -p action=<act>` shape that has a v0.7 equivalent,
// emit a one-line deprecation suggestion on stderr (does not change behavior).
//
// Policy correction (v0.7.2): `unictl command` itself is permanent — it
// stays as the canonical dispatcher for builtin tools without a v0.7 verb
// (capture_ui, editor_log, execute_menu, ping, ugui_input, ui_toolkit_input,
// build_status, build_cancel, editor_control action=load_scene) AND for all
// consumer-defined `[UnictlTool]` registrations. v1.0 hard-removes only the
// specific invocation patterns mapped below. `unictl command list` is NOT
// deprecated — it is the canonical runtime discovery channel and is NOT
// equivalent to `unictl schema` (which only covers v0.7 verb-noun).
function suggestV07Mapping(toolName: string, params: Record<string, unknown>): string | null {
  if (toolName === "editor_control") {
    const action = typeof params.action === "string" ? params.action : null;
    switch (action) {
      case "play":     return "unictl editor play";
      case "stop":     return "unictl editor stop";
      case "compile":  return "unictl editor compile";
      case "refresh":  return "unictl editor refresh";
      case "status":   return "unictl editor status";
      default:         return null;
    }
  }
  return null;
}

const commandCmd = defineCommand({
  meta: {
    name: "command",
    description: "Invoke a UnictlTool by name. Params: -p key=value | @file.json | stdin JSON. Use 'list' to see all tools. Add custom tools with [UnictlTool] attribute in C#.",
  },
  args: {
    tool: {
      type: "positional",
      required: false,
      description: "UnictlTool name to invoke (e.g. editor_control, capture_ui). Omit to list all tools.",
    },
    p: {
      type: "string",
      description: "Parameter as key=value (repeatable, e.g. -p action=play -p speed=2)",
    },
    format: {
      type: "string",
      default: "json",
      description: "Output format for editor_log: json or text. Text emits raw lines/matches/errors for shell pipes.",
    },
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
    describe: {
      type: "boolean",
      description: "Deprecated alias for `unictl schema command`.",
    },
  },
  run: async ({ args, rawArgs }) => {
    // Legacy compatibility: command contract metadata moved to `unictl schema`.
    // Per-tool metadata still flows through `unictl command list` at runtime.
    if (args.describe === true) {
      const meta = lookupCommandSchema("command");
      if (meta) {
        process.stderr.write("[deprecated] --describe is deprecated; use 'unictl schema command'.\n");
        console.log(JSON.stringify(meta));
        process.exit(0);
      }
    }
    try {
      const toolName = args.tool ? String(args.tool) : "list";
      const params = await resolveParams(rawArgs);
      const format = typeof args.format === "string" ? args.format : "json";
      if (format !== "json" && format !== "text") {
        output({ ok: false, error: { kind: "invalid_param", message: `Unknown --format '${format}'. Valid: json, text.` } });
        process.exit(2);
      }
      if (format === "text" && toolName !== "editor_log") {
        output({ ok: false, error: { kind: "invalid_param", message: "--format text is currently supported only for editor_log." } });
        process.exit(2);
      }
      const suggestion = suggestV07Mapping(toolName, params ?? {});
      if (suggestion) {
        process.stderr.write(
          `[deprecated] 'unictl command ${toolName}' has a v0.7 equivalent: ${suggestion}\n`,
        );
      }
      const response = await command(toolName, params, { project: args.project });
      if (format === "text" && toolName === "editor_log") {
        if (!emitEditorLogText(response)) output(response);
      } else {
        output(response);
      }
      if (
        response &&
        typeof response === "object" &&
        (((response as { success?: unknown }).success === false) ||
          ((response as { ok?: unknown }).ok === false))
      ) {
        process.exit(1);
      }
    } catch (error) {
      outputErrorAndExit(error);
    }
  },
});

const describeAllCmd = defineCommand({
  meta: {
    name: "describe-all",
    description: "Deprecated alias for `unictl schema`.",
  },
  run: async () => {
    process.stderr.write("[deprecated] describe-all is deprecated; use 'unictl schema'.\n");
    console.log(JSON.stringify(schemaAll()));
  },
});

const schemaCmd = defineCommand({
  meta: {
    name: "schema",
    description: "Emit machine-readable command contracts for agents and automation.",
  },
  args: {
    command: {
      type: "positional",
      required: false,
      description: "Canonical command name, e.g. editor.open, editor.compile, input.set. Omit for all commands.",
    },
  },
  run: async ({ args }) => {
    const commandName = typeof args.command === "string" ? args.command.trim() : "";
    if (commandName.length === 0) {
      console.log(JSON.stringify(schemaAll()));
      return;
    }

    const meta = lookupCommandSchema(commandName);
    if (!meta) {
      output({
        ok: false,
        error: {
          kind: "schema_not_found",
          message: `No command schema found for '${commandName}'.`,
          recovery: "Run 'unictl schema' to list available command contracts.",
        },
      });
      process.exit(2);
    }

    console.log(JSON.stringify(meta));
  },
});

const healthCmd = defineCommand({
  meta: { name: "health", description: "Check the current unictl endpoint health" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
  },
  run: async ({ args }) => {
    try {
      output(await health({ project: args.project }));
    } catch (error) {
      outputErrorAndExit(error);
    }
  },
});

const versionCmd = defineCommand({
  meta: { name: "version", description: "Show CLI and embedded package version metadata" },
  run: async () => {
    try {
      output(getVersionInfo());
    } catch (error) {
      outputErrorAndExit(error);
    }
  },
});

const capabilitiesCmd = defineCommand({
  meta: { name: "capabilities", description: "Print offline capabilities JSON for cold-start agent discovery (no live editor required)" },
  run: async () => {
    try {
      console.log(JSON.stringify(caps, null, 2));
    } catch (error) {
      outputErrorAndExit(error);
    }
  },
});

const doctorCmd = defineCommand({
  meta: { name: "doctor", description: "Run installation and endpoint diagnostics" },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
  },
  run: async ({ args }) => {
    try {
      const result = await runDoctor(args.project);
      output(result);
      if (!result.success) {
        const kind = (result.error as Record<string, unknown> | undefined)?.kind as string | undefined;
        if (kind === "project_not_detected") process.exit(2);
        if (kind === "ipc_error") process.exit(3);
        process.exit(1);
      }
    } catch (error) {
      outputErrorAndExit(error);
    }
  },
});

const initCmd = defineCommand({
  meta: {
    name: "init",
    description: "Add or update the `com.unictl.editor` dependency in manifest.json. This edits the manifest only; Unity resolves/imports the package on editor refresh, editor restart, or batch compile.",
  },
  args: {
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
    repoUrl: {
      type: "string",
      description: "Git repository URL for the standalone unictl repo",
    },
    packageRef: {
      type: "string",
      description: "Exact package reference to write into manifest.json",
    },
    version: {
      type: "string",
      description: "Package version tag (defaults to CLI version, ignored with --head)",
    },
    head: {
      type: "boolean",
      default: false,
      description: "Use HEAD (no tag pinning) — matches bunx github:repo behavior",
    },
    dryRun: {
      type: "boolean",
      default: false,
      description: "Show the planned manifest change without writing it",
    },
    force: {
      type: "boolean",
      default: false,
      description: "Replace an existing differing com.unictl.editor reference",
    },
  },
  run: async ({ args }) => {
    try {
      const result = runInit({
        project: args.project,
        repoUrl: args.repoUrl,
        packageRef: args.packageRef,
        version: args.version,
        head: args.head,
        dryRun: args.dryRun,
        force: args.force,
      });
      output(result);
      if (!result.success) process.exit(1);
    } catch (error) {
      outputErrorAndExit(error);
    }
  },
});

// ---------------------------------------------------------------------------
// main command
// ---------------------------------------------------------------------------

const main = defineCommand({
  meta: {
    name: "unictl",
    version: getCliPackageMeta().version,
    description: `Unity editor control CLI

${AGENT_HELP_BANNER}

QUICK START (run in order):
  1. unictl health                          # verify editor connection
  2. unictl command list                    # discover all tools and actions
  3. unictl command <TOOL> -p action=<ACT>  # invoke a tool
  4. unictl build --target X --wait        # build the project
  5. unictl compile                         # headless compile + .meta gen`,
  },
  subCommands: {
    build: buildCmd,
    capabilities: capabilitiesCmd,
    compile: compileCmd,
    command: commandCmd,
    "describe-all": describeAllCmd,
    doctor: doctorCmd,
    editor: editorCmd,
    health: healthCmd,
    init: initCmd,
    schema: schemaCmd,
    test: testCmd,
    version: versionCmd,
    // v0.7 verb-noun additions (Phase C-skeleton). Stub bodies for now —
    // wait wires in Phase D; input / deploy / scripting / settings wire in Phase E.
    input: v07TopLevelCommands.input,
    deploy: v07TopLevelCommands.deploy,
    scripting: v07TopLevelCommands.scripting,
    settings: v07TopLevelCommands.settings,
    wait: v07TopLevelCommands.wait,
  },
});

// ---------------------------------------------------------------------------
// --help --json intercept (must run before citty processes --help)
// ---------------------------------------------------------------------------

const rawArgv = process.argv.slice(2);
const hasHelp = rawArgv.includes("--help") || rawArgv.includes("-h");
const hasJson = rawArgv.includes("--json");

if (hasHelp && hasJson) {
  const commandPath: string[] = [];
  for (const arg of rawArgv) {
    if (arg === "--help" || arg === "-h" || arg === "--json") continue;
    if (arg.startsWith("-")) break;
    commandPath.push(arg);
  }

  for (let len = commandPath.length; len > 0; len--) {
    const schemaName = commandPath.slice(0, len).join(".");
    const schemaMeta = lookupCommandSchema(schemaName);
    if (schemaMeta) {
      console.log(JSON.stringify({
        ...schemaMeta,
        replacement: `unictl schema ${schemaName}`,
      }, null, 2));
      process.exit(0);
    }
  }

  // Determine subcommand: first non-flag positional arg (if any)
  const knownSubcommands = new Set(Object.keys(main.subCommands ?? {}));
  let cmdName: string | undefined;
  for (const arg of rawArgv) {
    if (!arg.startsWith("-") && knownSubcommands.has(arg)) {
      cmdName = arg;
      break;
    }
  }

  // Provide citty args definition for the subcommand when available
  const subCmdArgsDef: Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }> | undefined =
    cmdName === "build"
      ? buildCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : cmdName === "compile"
      ? compileCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : cmdName === "command"
      ? commandCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : cmdName === "doctor"
      ? doctorCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : cmdName === "init"
      ? initCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : cmdName === "health"
      ? healthCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : cmdName === "version"
      ? {}
      : cmdName === "capabilities"
      ? {}
      : cmdName === "schema"
      ? schemaCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : cmdName === "test"
      ? testCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : undefined;

  const editorSubCmd = commandPath[0] === "editor" ? commandPath[1] : undefined;
  const editorSubCmdArgsDef: Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }> | undefined =
    editorSubCmd === "status"
      ? editorStatusCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : editorSubCmd === "quit"
      ? editorQuitCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : editorSubCmd === "open"
      ? editorOpenCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : editorSubCmd === "restart"
      ? editorRestartCmd.args as Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
      : undefined;

  if (editorSubCmdArgsDef) {
    console.log(JSON.stringify(formatHelpJson(`editor.${editorSubCmd}`, editorSubCmdArgsDef), null, 2));
    process.exit(0);
  }

  console.log(JSON.stringify(formatHelpJson(cmdName, subCmdArgsDef), null, 2));
  process.exit(0);
}

if (rawArgv.includes("--describe")) {
  const commandPath: string[] = [];
  for (const arg of rawArgv) {
    if (arg === "--describe") continue;
    if (arg.startsWith("-")) break;
    commandPath.push(arg);
  }

  for (let len = commandPath.length; len > 0; len--) {
    const schemaName = commandPath.slice(0, len).join(".");
    const schemaMeta = lookupCommandSchema(schemaName);
    if (schemaMeta) {
      process.stderr.write(`[deprecated] --describe is deprecated; use 'unictl schema ${schemaName}'.\n`);
      console.log(JSON.stringify(schemaMeta));
      process.exit(0);
    }
  }
}

if (rawArgv[0] === "test" && rawArgv[1] === "wait") {
  await runTestWaitCli(normalizeKnownFlags(rawArgv.slice(2)));
}

if (rawArgv[0] === "build" && rawArgv[1] === "status") {
  await runBuildStatusCli(normalizeKnownFlags(rawArgv.slice(2)));
}

if (rawArgv[0] === "build" && rawArgv[1] === "cancel") {
  await runBuildCancelCli(normalizeKnownFlags(rawArgv.slice(2)));
}

runMain(main, { rawArgs: normalizeKnownFlags(rawArgv) });
