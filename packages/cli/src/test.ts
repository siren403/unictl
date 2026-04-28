import { defineCommand } from "citty";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { getProjectPaths } from "./socket";
import { readUnityVersion, resolveUnityBinary, killProcess } from "./process";
import { command, health } from "./client";
import { errorExit } from "./error";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestPlatform = "editmode" | "playmode";

export type TestResult = {
  ok: boolean;
  platform: TestPlatform;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results_file: string;
  log_file: string;
  duration_ms: number;
};

// ---------------------------------------------------------------------------
// XML parsing — NUnit test-run format
// ---------------------------------------------------------------------------

type NUnitSummary = {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
};

function parseNUnitXml(xmlContent: string): NUnitSummary | null {
  // Match <test-run total="N" passed="N" failed="N" skipped="N" ... >
  const match = xmlContent.match(/<test-run\b([^>]*)>/);
  if (!match) return null;

  const attrs = match[1];

  function attr(name: string): number {
    const m = attrs.match(new RegExp(`\\b${name}="(\\d+)"`));
    return m ? parseInt(m[1], 10) : 0;
  }

  return {
    total: attr("total"),
    passed: attr("passed"),
    failed: attr("failed"),
    skipped: attr("skipped"),
    errors: attr("errors"),
  };
}

// ---------------------------------------------------------------------------
// Crash / filter detection from stderr patterns
// ---------------------------------------------------------------------------

function hasCrashPattern(logContent: string): boolean {
  return /\bCrash\b/i.test(logContent);
}

function hasInvalidFilterPattern(logContent: string): boolean {
  return /Invalid test filter/i.test(logContent);
}

// ---------------------------------------------------------------------------
// runTest — core implementation
// ---------------------------------------------------------------------------

export async function runTest(opts: {
  projectRoot: string;
  platform: TestPlatform;
  resultsFile: string;
  filter?: string;
  timeoutSec?: number;
  unityVersion?: string;
}): Promise<TestResult> {
  const { projectRoot, platform, resultsFile, filter, timeoutSec } = opts;

  const resolvedResults = resolve(resultsFile);

  // Ensure parent directory exists
  const resultsDir = resolvedResults.slice(0, Math.max(resolvedResults.lastIndexOf("/"), resolvedResults.lastIndexOf("\\")));
  if (resultsDir) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const unityVersion = opts.unityVersion ?? readUnityVersion(projectRoot);
  const unityBin = resolveUnityBinary(unityVersion);

  if (!existsSync(unityBin)) {
    errorExit(125, "unity_not_found", `Unity binary not found: ${unityBin}`);
  }

  // Log file: Library/unictl-tests/<timestamp>.log
  const testsDir = join(projectRoot, "Library", "unictl-tests");
  mkdirSync(testsDir, { recursive: true });
  const logFile = join(testsDir, `test-${Date.now()}.log`);

  const unityArgs: string[] = [
    unityBin,
    "-batchmode",
    "-projectPath", projectRoot,
    "-executeMethod", "Unictl.BatchTestRunner.RunFromCommandLine",
    "-unictlTestResults", resolvedResults,
    "-unictlTestPlatform", platform,
    "-logFile", logFile,
    "-quit",
  ];

  // EditMode: -nographics is safe; PlayMode requires rendering so omit it
  if (platform === "editmode") {
    unityArgs.splice(2, 0, "-nographics");
  }

  if (filter) {
    if (filter.startsWith("assembly:")) {
      unityArgs.push("-unictlTestAssembly", filter.slice("assembly:".length));
    } else {
      unityArgs.push("-unictlTestFilter", filter);
    }
  }

  const startTime = Date.now();

  const proc = Bun.spawn(unityArgs, {
    stdio: ["ignore", "ignore", "pipe"],
    detached: false,
  });

  // Timeout handling
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (timeoutSec !== undefined && timeoutSec > 0) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        killProcess(proc.pid, true);
      } catch {
        // process may already be gone
      }
    }, timeoutSec * 1000);
  }

  // Collect stderr for crash/filter pattern detection
  const stderrChunks: Buffer[] = [];
  if (proc.stderr) {
    const reader = proc.stderr.getReader();
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) stderrChunks.push(Buffer.from(value));
        }
      } catch {
        // ignore
      }
    })();
  }

  await proc.exited;
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

  const durationMs = Date.now() - startTime;
  const procExitCode = proc.exitCode ?? -1;

  // Collect log content for pattern matching (stderr + log file)
  const stderrContent = Buffer.concat(stderrChunks).toString("utf-8");
  let logContent = stderrContent;
  if (existsSync(logFile)) {
    try {
      logContent += readFileSync(logFile, "utf-8");
    } catch {
      // ignore read error
    }
  }

  // --- Exit code remapping logic ---

  // Timeout
  if (timedOut) {
    errorExit(6, "test_timeout", `Unity test run timed out after ${timeoutSec}s`, `unictl test --batch --platform ${platform} --timeout 600 --results ${resultsFile}`);
  }

  // Crash detection (abnormal exit or crash pattern)
  const abnormalExit = procExitCode !== 0 && procExitCode !== 1;
  if (hasCrashPattern(logContent) || (abnormalExit && procExitCode !== -1)) {
    errorExit(5, "unity_crash", `Unity crashed or exited abnormally (exit code=${procExitCode})`, "unictl doctor -p <project>");
  }

  // Invalid filter
  if (hasInvalidFilterPattern(logContent)) {
    errorExit(7, "test_invalid_filter", `Unity reported an invalid test filter`, `unictl test --batch --platform ${platform} --filter <assembly:AssemblyName> --results ${resolvedResults}`);
  }

  // XML existence + parsing
  if (!existsSync(resolvedResults)) {
    // proc exited 0 but no XML = xml_parse_failed
    errorExit(4, "xml_parse_failed", `Test results XML not found at: ${resolvedResults} (Unity exit code=${procExitCode})`, `unictl test --batch --platform ${platform} --results ${resolvedResults}`);
  }

  let xmlContent: string;
  try {
    xmlContent = readFileSync(resolvedResults, "utf-8");
  } catch (e) {
    errorExit(4, "xml_parse_failed", `Could not read test results XML: ${(e as Error).message}`, `unictl test --batch --platform ${platform} --results ${resolvedResults}`);
  }

  const summary = parseNUnitXml(xmlContent!);
  if (!summary) {
    errorExit(4, "xml_parse_failed", `Could not parse NUnit XML at: ${resolvedResults}`, `unictl test --batch --platform ${platform} --results ${resolvedResults}`);
  }

  const { total, passed, failed, skipped, errors } = summary!;

  // No assemblies found
  if (total === 0) {
    errorExit(3, "no_assemblies", `No tests found (total=0). Verify that test assemblies are configured for platform '${platform}'.`, `unictl test --batch --platform editmode --results ${resolvedResults}`);
  }

  // Tests failed
  if (failed > 0 || errors > 0) {
    const failCount = failed + errors;
    errorExit(1, "tests_failed", `${failCount} test(s) failed (failed=${failed}, errors=${errors})`, `unictl test --batch --platform ${platform} --results ${resolvedResults}`);
  }

  // Unknown failure: proc exited non-zero but XML parsed OK
  if (procExitCode !== 0) {
    errorExit(8, "unknown_test_failure", `Tests appeared to pass (failCount=0) but Unity exited with code ${procExitCode}`, `unictl test --batch --platform ${platform} --results ${resolvedResults}`);
  }

  // Success
  return {
    ok: true,
    platform,
    total,
    passed,
    failed,
    skipped,
    results_file: resolvedResults,
    log_file: logFile,
    duration_ms: durationMs,
  };
}

// ---------------------------------------------------------------------------
// Editor lane helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    // EPERM = process exists but we cannot signal it (still alive)
    return e.code === "EPERM";
  }
}

/** Parse --filter into { assembly, testFilter } for the IPC request. */
function parseFilter(filter: string | undefined): { assembly: string | null; testFilter: string | null } {
  if (!filter) return { assembly: null, testFilter: null };
  if (filter.startsWith("assembly:")) {
    return { assembly: filter.slice("assembly:".length), testFilter: null };
  }
  return { assembly: null, testFilter: filter };
}

/**
 * Check whether a Unity editor is running for this project and the IPC
 * server is reachable.  Returns true only if both lockfile present AND
 * health call succeeds with handler_registered.
 */
async function detectEditorRunning(projectRoot: string): Promise<boolean> {
  // Unity 6+ doesn't always create UnityLockfile. Rely on IPC health (handler_registered)
  // which is authoritative — editor is "ready for editor lane" iff its IPC server is up.
  try {
    const h = await health({ project: projectRoot }) as any;
    return h && h.handler_registered === true;
  } catch {
    return false;
  }
}

type EditorLaneArgs = {
  projectRoot: string;
  platform: TestPlatform;
  resultsFile: string;
  filter?: string;
  timeoutSec?: number;
  allowUnsavedScenes: boolean;
  allowReloadActive: boolean;
};

async function runEditorLane(args: EditorLaneArgs): Promise<TestResult> {
  const { projectRoot, platform, resultsFile, filter, timeoutSec, allowUnsavedScenes, allowReloadActive } = args;

  const jobId = crypto.randomUUID();
  const resolvedResults = resolve(resultsFile);
  const deadlineMs = timeoutSec && timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : 0;
  const { assembly, testFilter } = parseFilter(filter);

  const params: Record<string, unknown> = {
    schema_version: 1,
    platform,
    assembly,
    test_filter: testFilter,
    results_path: resolvedResults,
    job_id: jobId,
    timeout_deadline_ms: deadlineMs,
    allow_unsaved_scenes: allowUnsavedScenes,
    allow_reload_active: allowReloadActive,
  };

  let resp: any;
  try {
    resp = await command("test_run", params, { project: projectRoot });
  } catch (e: any) {
    errorExit(3, "ipc_error", `IPC call failed: ${e.message}`);
  }

  if (!resp.ok) {
    const err = resp.error ?? {};
    errorExit(2, err.kind ?? "ipc_error", err.message ?? "test_run IPC call rejected", err.hint_command ?? undefined);
  }

  const expectedSession: string = resp.editor_session_id;
  const expectedPid: number = resp.editor_pid;
  const progressPath = resolve(projectRoot, resp.progress_file);

  let interval = 250;
  const maxInterval = 2000;
  const HEARTBEAT_STALE_MS = 5000;

  while (true) {
    await sleep(interval);
    interval = Math.min(Math.floor(interval * 1.5), maxInterval);

    // editor liveness check
    if (!isPidAlive(expectedPid)) {
      errorExit(8, "editor_died", `Editor process (pid=${expectedPid}) exited unexpectedly during test run.`);
    }

    if (!existsSync(progressPath)) continue;

    let job: Record<string, any>;
    try {
      job = JSON.parse(readFileSync(progressPath, "utf-8").replace(/^﻿/, ""));
    } catch {
      continue; // partial read; retry next iteration
    }

    // session change detection (editor restarted)
    if (job.editor_session_id && job.editor_session_id !== expectedSession) {
      errorExit(8, "editor_session_changed", `Editor session changed mid-run (expected=${expectedSession}, actual=${job.editor_session_id}).`);
    }

    // heartbeat stale (only check once state=running to avoid false positives on queued)
    if (job.state === "running" && job.last_update_ms > 0) {
      const sinceUpdate = Date.now() - job.last_update_ms;
      if (sinceUpdate > HEARTBEAT_STALE_MS) {
        errorExit(8, "test_heartbeat_stale", `No progress update for ${Math.floor(sinceUpdate / 1000)}s (last_update_ms=${job.last_update_ms}).`);
      }
    }

    // CLI-side deadline
    if (deadlineMs > 0 && Date.now() > deadlineMs) {
      errorExit(6, "test_timeout", `CLI timeout after ${timeoutSec}s.`);
    }

    switch (job.state) {
      case "queued":
      case "running":
        continue;

      case "finished": {
        const total: number = job.total ?? 0;
        const passed: number = job.passed ?? 0;
        const failed: number = job.failed ?? 0;
        const skipped: number = job.skipped ?? 0;
        const durationMs: number =
          job.run_finished_at_ms && job.run_started_at_ms
            ? job.run_finished_at_ms - job.run_started_at_ms
            : 0;

        if (failed > 0) {
          errorExit(1, "tests_failed", `${failed} test(s) failed (failed=${failed}, total=${total})`);
        }

        return {
          ok: true,
          platform,
          total,
          passed,
          failed,
          skipped,
          results_file: job.results_path ?? resolvedResults,
          log_file: null as unknown as string,
          duration_ms: durationMs,
        };
      }

      case "failed":
        errorExit(
          8,
          (job.error_kind as string) ?? "unknown_test_failure",
          (job.error_message as string) ?? "Test run failed",
        );
        break;

      default:
        // unknown state — keep polling
        continue;
    }
  }
}

// ---------------------------------------------------------------------------
// test subcommand
// ---------------------------------------------------------------------------

export const testCmd = defineCommand({
  meta: {
    name: "test",
    description: `Run Unity tests via editor lane (IPC) or batchmode.

QUICK START:
  unictl test --platform editmode --results TestResults/results.xml
  unictl test --platform playmode --results TestResults/results.xml --filter assembly:MyAssembly
  unictl test --batch --platform editmode --results out.xml --timeout 300

LANE SELECTION:
  (default)  Editor lane — uses running Unity editor via IPC (fast, no relaunch)
  --batch    Batchmode  — launches a new headless Unity process (use when editor is not running)

PLATFORM:
  editmode   Edit Mode tests (no player build required, fastest)
  playmode   Play Mode tests (requires DisableDomainReload for editor lane)

FILTER SYNTAX (Unity -testFilter):
  assembly:MyAssembly              all tests in assembly
  MyNamespace.MyClass              all tests in class
  MyNamespace.MyClass.MyMethod     specific test method

EXIT CODES:
  0   success (all tests passed)
  1   tests failed
  2   editor not running / preflight rejection (see error.kind)
  3   no_assemblies (no tests found)
  4   xml_parse_failed (Unity exited 0 but no valid XML)
  5   unity_crash (crash pattern or abnormal exit)
  6   test_timeout (wall-clock timeout exceeded)
  7   test_invalid_filter (Unity rejected the filter expression)
  8   editor_died / editor_session_changed / test_heartbeat_stale / unknown_test_failure`,
  },
  args: {
    batch: {
      type: "boolean",
      default: false,
      description: "Run in batchmode (headless Unity process). Use when editor is not running.",
    },
    platform: {
      type: "string",
      description: "Test platform: editmode or playmode",
    },
    results: {
      type: "string",
      description: "Output XML file path for NUnit test results",
    },
    filter: {
      type: "string",
      description: "Unity -testFilter expression (assembly, namespace, class, or method)",
    },
    timeout: {
      type: "string",
      description: "Wall-clock timeout in seconds (0 = unlimited)",
    },
    editorVersion: {
      type: "string",
      description: "Override Unity editor version (batchmode only; default: read from ProjectVersion.txt)",
    },
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
    allowUnsavedScenes: {
      type: "boolean",
      default: false,
      description: "Editor lane: bypass dirty-scene preflight check (PlayMode)",
    },
    allowReloadActive: {
      type: "boolean",
      default: false,
      description: "Editor lane: attempt PlayMode tests with full domain reload enabled (dangerous, may hang)",
    },
  },
  run: async ({ args }) => {
    // Validate --platform
    const platform = args.platform as TestPlatform | undefined;
    if (!platform || (platform !== "editmode" && platform !== "playmode")) {
      errorExit(2, "invalid_param", `--platform is required and must be 'editmode' or 'playmode' (got: '${platform ?? ""}')`, "unictl test --platform <editmode|playmode> --results <output.xml>");
    }

    // Validate --results
    const resultsFile = args.results;
    if (!resultsFile) {
      errorExit(2, "invalid_param", "--results is required: provide an output XML file path", "unictl test --platform <editmode|playmode> --results <output.xml>");
    }

    const { projectRoot } = getProjectPaths(args.project);
    const timeoutSec = args.timeout ? (parseInt(args.timeout, 10) || 0) : undefined;

    // Lane routing
    if (args.batch) {
      const editorRunning = await detectEditorRunning(projectRoot);
      if (editorRunning) {
        errorExit(
          3,
          "editor_running",
          "Editor is already running. Quit it first or omit --batch to use editor lane.",
          "unictl editor quit"
        );
      }
      const result = await runTest({
        projectRoot,
        platform: platform!,
        resultsFile: resultsFile!,
        filter: args.filter,
        timeoutSec: timeoutSec && timeoutSec > 0 ? timeoutSec : undefined,
        unityVersion: args.editorVersion,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exit(0);
    }

    // Editor lane: auto-fallback to batchmode if editor is not running
    const editorRunning = await detectEditorRunning(projectRoot);
    if (!editorRunning) {
      const result = await runTest({
        projectRoot,
        platform: platform!,
        resultsFile: resultsFile!,
        filter: args.filter,
        timeoutSec: timeoutSec && timeoutSec > 0 ? timeoutSec : undefined,
        unityVersion: args.editorVersion,
      });
      process.stdout.write(JSON.stringify(result) + "\n");
      process.exit(0);
    }

    const result = await runEditorLane({
      projectRoot,
      platform: platform!,
      resultsFile: resultsFile!,
      filter: args.filter,
      timeoutSec: timeoutSec && timeoutSec > 0 ? timeoutSec : undefined,
      allowUnsavedScenes: args.allowUnsavedScenes ?? false,
      allowReloadActive: args.allowReloadActive ?? false,
    });

    process.stdout.write(JSON.stringify(result) + "\n");
    process.exit(0);
  },
});
