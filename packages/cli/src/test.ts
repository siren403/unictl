import { defineCommand } from "citty";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { getProjectPaths } from "./socket";
import { readUnityVersion, resolveUnityBinary, killProcess } from "./process";
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
// test subcommand
// ---------------------------------------------------------------------------

export const testCmd = defineCommand({
  meta: {
    name: "test",
    description: `Run Unity tests in batchmode (--batch required; editor lane planned for v0.6.0).

QUICK START:
  unictl test --batch --platform editmode --results TestResults/results.xml
  unictl test --batch --platform playmode --results TestResults/results.xml --filter MyAssembly
  unictl test --batch --platform editmode --results out.xml --timeout 300

PLATFORM:
  editmode   Edit Mode tests (no player build required, fastest)
  playmode   Play Mode tests (requires player build step, slower)

FILTER SYNTAX (Unity -testFilter):
  assembly:MyAssembly              all tests in assembly
  MyNamespace.MyClass              all tests in class
  MyNamespace.MyClass.MyMethod     specific test method

EXIT CODES:
  0   success (all tests passed)
  1   tests failed
  2   editor_lane_unavailable (--batch flag missing)
  3   no_assemblies (no tests found)
  4   xml_parse_failed (Unity exited 0 but no valid XML)
  5   unity_crash (crash pattern or abnormal exit)
  6   timeout (wall-clock timeout exceeded)
  7   test_invalid_filter (Unity rejected the filter expression)
  8   unknown_test_failure (fallback bucket)`,
  },
  args: {
    batch: {
      type: "boolean",
      default: false,
      description: "Required: run in batchmode (editor lane is planned for v0.6.0)",
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
      description: "Override Unity editor version (default: read from ProjectVersion.txt)",
    },
    project: {
      type: "string",
      description: "Unity project path (auto-detected if omitted)",
    },
  },
  run: async ({ args }) => {
    // --batch is required; without it emit editor_lane_unavailable and exit 2
    if (!args.batch) {
      errorExit(
        2,
        "editor_lane_unavailable",
        "Editor lane is not yet available. Use --batch to run tests in headless batchmode.",
        "unictl test --batch --platform <editmode|playmode> --results <output.xml>"
      );
    }

    // Validate --platform
    const platform = args.platform as TestPlatform | undefined;
    if (!platform || (platform !== "editmode" && platform !== "playmode")) {
      errorExit(2, "invalid_param", `--platform is required and must be 'editmode' or 'playmode' (got: '${platform ?? ""}')`, "unictl test --batch --platform <editmode|playmode> --results <output.xml>");
    }

    // Validate --results
    const resultsFile = args.results;
    if (!resultsFile) {
      errorExit(2, "invalid_param", "--results is required: provide an output XML file path", "unictl test --batch --platform <editmode|playmode> --results <output.xml>");
    }

    const { projectRoot } = getProjectPaths(args.project);
    const timeoutSec = args.timeout ? (parseInt(args.timeout, 10) || 0) : undefined;

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
  },
});
