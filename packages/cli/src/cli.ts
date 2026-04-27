#!/usr/bin/env bun
import { defineCommand, runMain } from "citty";
import { readFileSync } from "fs";
import caps from "./capabilities.json" assert { type: "json" };
import { command, health } from "./client";
import { formatHelpJson } from "./help-json";
import { buildCmd } from "./build";
import { runCompile } from "./compile";
import { editorStatus, editorQuit, editorOpen, editorRestart } from "./editor";
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
    if (args[i] === "-p" && i + 1 < args.length) {
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
      output({ error: e.message });
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
  },
  run: async ({ args }) => {
    try {
      output(await editorQuit({ project: args.project, force: args.force }));
    } catch (e: any) {
      output({ error: e.message });
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
  },
  run: async ({ args }) => {
    try {
      output(await editorOpen({ project: args.project, skipPrecompile: args.skipPrecompile }));
    } catch (e: any) {
      output({ error: e.message });
      process.exit(1);
    }
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
      output({ error: e.message });
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
        output({ ...result, ok: false, error: { kind: "compile_failed", message } });
        process.exit(1);
      }
      output({ ok: true, ...result });
    } catch (e: any) {
      const kind: string | undefined = e.kind;
      if (kind === "editor_running" || kind === "project_locked") {
        output({ ok: false, error: { kind, message: e.message } });
        process.exit(3);
      }
      if (kind === "timeout") {
        output({ ok: false, error: { kind: "timeout", message: e.message }, duration_ms: e.duration_ms, log_file: e.log_file });
        process.exit(124);
      }
      output({ ok: false, error: { kind: kind ?? "ipc_error", message: e.message } });
      process.exit(125);
    }
  },
});

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
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
  },
  run: async ({ args, rawArgs }) => {
    try {
      const toolName = args.tool ? String(args.tool) : "list";
      const params = await resolveParams(rawArgs);
      output(await command(toolName, params, { project: args.project }));
    } catch (error) {
      outputErrorAndExit(error);
    }
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
  meta: { name: "init", description: "Add or update the `com.unictl.editor` dependency in manifest.json" },
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
    doctor: doctorCmd,
    editor: editorCmd,
    health: healthCmd,
    init: initCmd,
    version: versionCmd,
  },
});

// ---------------------------------------------------------------------------
// --help --json intercept (must run before citty processes --help)
// ---------------------------------------------------------------------------

const rawArgv = process.argv.slice(2);
const hasHelp = rawArgv.includes("--help") || rawArgv.includes("-h");
const hasJson = rawArgv.includes("--json");

if (hasHelp && hasJson) {
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
      : undefined;

  console.log(JSON.stringify(formatHelpJson(cmdName, subCmdArgsDef), null, 2));
  process.exit(0);
}

runMain(main, { rawArgs: normalizeKnownFlags(rawArgv) });
