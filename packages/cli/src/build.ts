import { defineCommand } from "citty";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { join, isAbsolute, relative, resolve } from "path";
import { getProjectPaths } from "./socket";
import { getUnityPid, listUnityProcesses, isBatchModeWorker, readUnityVersion, resolveUnityBinary, getUnityLockfilePath } from "./process";
import { command } from "./client";
import { errorExit } from "./error";
import { normalizeBuildProgress } from "./build-lifecycle";

// ---------------------------------------------------------------------------
// Library/unictl-builds helpers
// ---------------------------------------------------------------------------

/** Returns the canonical builds directory for a project root. */
export function getBuildsDir(projectRoot: string): string {
  return join(projectRoot, "Library", "unictl-builds");
}

/** Ensures the builds directory exists (mkdir -p). */
export function ensureBuildsDir(projectRoot: string): void {
  mkdirSync(getBuildsDir(projectRoot), { recursive: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseBuildCompanionArgs(rawArgs: string[]): { project?: string; jobId?: string } {
  let project: string | undefined;
  let jobId: string | undefined;

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === "--project") {
      project = rawArgs[++i];
    } else if (arg === "--job-id" || arg === "--jobId") {
      jobId = rawArgs[++i];
    } else if (!arg.startsWith("-") && !jobId) {
      jobId = arg;
    }
  }

  return { project, jobId };
}

function parseMethodParams(rawArgs: string[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    let value: string | undefined;
    if (arg === "--method-param" || arg === "--methodParam") {
      value = rawArgs[++i];
    } else if (arg.startsWith("--method-param=")) {
      value = arg.slice("--method-param=".length);
    } else if (arg.startsWith("--methodParam=")) {
      value = arg.slice("--methodParam=".length);
    }
    if (!value) continue;
    const eq = value.indexOf("=");
    if (eq <= 0) {
      errorExit(2, "invalid_param", `--method-param must be key=value: '${value}'`, "unictl build --method Namespace.Type.Method --method-param channel=release");
    }
    params[value.slice(0, eq)] = value.slice(eq + 1);
  }
  return params;
}

function readMethodParamsJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    errorExit(2, "invalid_param", `--method-params-json file not found: ${path}`);
  }
  let parsed: unknown;
  try {
    const raw = readFileSync(path, "utf-8").replace(/^﻿/, "");
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    errorExit(2, "invalid_param", `Failed to read --method-params-json '${path}': ${(err as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    errorExit(2, "invalid_param", `--method-params-json must point to a JSON object: ${path}`);
  }
  return parsed as Record<string, unknown>;
}

function isUnityProcessForProject(command: string, projectRoot: string): boolean {
  const normalizedRoot = projectRoot.replace(/\\/g, "/").toLowerCase();
  const cmdLower = command.replace(/\\/g, "/").toLowerCase();
  return cmdLower.includes(`-projectpath ${normalizedRoot}`)
    || cmdLower.includes(`-projectpath "${normalizedRoot}"`);
}

function readNormalizedBuildStatus(projectRoot: string, jobId: string): Record<string, unknown> {
  const progressPath = join(getBuildsDir(projectRoot), `${jobId}.json`);
  if (!existsSync(progressPath)) {
    errorExit(
      2,
      "job_not_found",
      `No progress file for job: ${jobId}`,
      `Verify the id returned by unictl build, or poll with: unictl build status --job-id ${jobId}`
    );
  }

  try {
    const raw = readFileSync(progressPath, "utf-8").replace(/^﻿/, "");
    return normalizeBuildProgress(JSON.parse(raw) as Record<string, unknown>, jobId);
  } catch (err) {
    errorExit(
      125,
      "progress_read_failed",
      `Failed to read progress file for job ${jobId}: ${(err as Error).message}`,
      `Retry: unictl build status --job-id ${jobId}`
    );
  }
}

export async function runBuildStatusCli(rawArgs: string[]): Promise<void> {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(`Usage: unictl build status --job-id <id> [--project <path>]

Read a build lifecycle status using the first-class build workflow.
Returns normalized states: queued, running, succeeded, failed, cancelled.
`);
    process.exit(0);
  }

  const { project, jobId } = parseBuildCompanionArgs(rawArgs);
  if (!jobId) {
    errorExit(2, "invalid_param", "--job-id is required", "unictl build status --job-id <id> --project <path>");
  }

  const { projectRoot } = getProjectPaths(project);
  process.stdout.write(JSON.stringify(readNormalizedBuildStatus(projectRoot, jobId)) + "\n");
  process.exit(0);
}

export async function runBuildCancelCli(rawArgs: string[]): Promise<void> {
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(`Usage: unictl build cancel --job-id <id> [--project <path>]

Request cooperative cancellation for a queued build.
Running Unity BuildPipeline builds cannot be interrupted safely.
`);
    process.exit(0);
  }

  const { project, jobId } = parseBuildCompanionArgs(rawArgs);
  if (!jobId) {
    errorExit(2, "invalid_param", "--job-id is required", "unictl build cancel --job-id <id> --project <path>");
  }

  const { projectRoot } = getProjectPaths(project);
  const pid = await getUnityPid(projectRoot);
  if (pid === null) {
    errorExit(
      3,
      "editor_not_running",
      "Build cancellation requires a reachable editor IPC session. Batchmode/running BuildPipeline jobs cannot be cancelled through unictl.",
      `Check status instead: unictl build status --job-id ${jobId}`
    );
  }

  let result: unknown;
  try {
    result = await command("build_cancel", { job_id: jobId }, { project: projectRoot });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errorExit(125, "ipc_error", `IPC call failed: ${msg}`);
  }

  const r = result as Record<string, unknown>;
  const data = r?.data as Record<string, unknown> | undefined;
  if (data) {
    if (typeof data.previous_state === "string") data.previous_state = normalizeBuildProgress({ state: data.previous_state }).state;
    if (typeof data.new_state === "string") data.new_state = normalizeBuildProgress({ state: data.new_state }).state;
    data.status_command = `unictl build status --job-id ${jobId}`;
  }
  process.stdout.write(JSON.stringify(r) + "\n");
  if (r && r.success === false) process.exit(1);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Polling — §2.5 / §2.5.1
// ---------------------------------------------------------------------------

async function pollUntilTerminal(
  progressPath: string,
  jobId: string,
  timeoutSec: number
): Promise<void> {
  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : Infinity;

  // Phase 1: 3s grace — progress 파일 출현 대기 (200ms 간격)
  const graceEnd = Date.now() + 3000;
  while (Date.now() < graceEnd && !existsSync(progressPath)) {
    await sleep(200);
  }
  if (!existsSync(progressPath)) {
    errorExit(
      3,
      "ipc_no_progress_file",
      `No progress file appeared within 3s for job ${jobId}: ${progressPath}`,
      "IPC ack received but no progress file appeared in 3 s; check: unictl doctor"
    );
  }

  // Phase 2: 500ms 간격으로 터미널 상태까지 polling
  let lastState = "";
  while (true) {
    if (Date.now() > deadline) {
      process.stderr.write(
        JSON.stringify({
          ok: false,
          error: {
            kind: "timeout",
            message: `CLI wait timeout reached; build still in progress. Poll with: unictl build status --job-id ${jobId}`,
            hint: `poll: unictl build status --job-id ${jobId}`,
          },
        }) + "\n"
      );
      process.exit(124);
    }

    try {
      const raw = readFileSync(progressPath, "utf-8").replace(/^﻿/, "");
      const obj = normalizeBuildProgress(JSON.parse(raw) as Record<string, unknown>, jobId);
      const state = obj.state as string;

      // 상태 변경 시에만 출력
      if (state !== lastState) {
        process.stdout.write(JSON.stringify(filterLifecycleSummary(obj, jobId)) + "\n");
        lastState = state;
      }

      if (state === "succeeded") process.exit(0);
      if (state === "failed" || state === "cancelled") {
        process.exit(1);
      }
    } catch {
      // §2.4 reader retry — JSON 파싱 실패 시 재시도
    }

    await sleep(500);
  }
}

/** Agent-facing lifecycle fields emitted by build wait/status streams. */
function filterLifecycleSummary(obj: Record<string, unknown>, jobId: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    job_id: obj.job_id ?? jobId,
    state: obj.state,
    terminal: obj.terminal,
    raw_state: obj.raw_state,
    result_source: obj.result_source,
    result_confidence: obj.result_confidence,
    elapsed_ms: obj.elapsed_ms,
    custom_method: obj.custom_method,
    method_elapsed_ms: obj.method_elapsed_ms,
    context_available: obj.context_available,
    context_started: obj.context_started,
    terminal_context_reported: obj.terminal_context_reported,
    phase: obj.phase,
    message: obj.message,
    progress: obj.progress,
    warnings: obj.warnings,
    suspicious: obj.suspicious,
    suspicion_reasons: obj.suspicion_reasons,
    recommended_action: obj.recommended_action,
  };
  if (obj.report_summary) out.report_summary = obj.report_summary;
  if (obj.error) out.error = obj.error;
  for (const key of Object.keys(out)) {
    if (out[key] === undefined || out[key] === null) delete out[key];
  }
  return out;
}

// ---------------------------------------------------------------------------
// build subcommand — P2a.1 실제 라우팅
// ---------------------------------------------------------------------------

export const buildCmd = defineCommand({
  meta: {
    name: "build",
    description: `Build a Unity player (auto-routes between live editor via IPC and headless batchmode).

QUICK START:
  unictl build --target StandaloneWindows64 --wait
  unictl build --target Android --build-profile Assets/Profiles/Android-Release.asset --timeout 3600
  unictl build --target iOS --batch --output Build/iOS --job-id ci-abc123
  unictl build --target StandaloneWindows64 --build-profile Assets/Settings/Profiles/Windows.asset --batch

LANE ROUTING:
  editor running     → IPC lane (--force-ipc accepted; known-limitation: third-party
                       EditorApplication.Exit hooks kill the editor; use --batch to avoid)
  editor not running → Batchmode lane
  multiple editors   → fail-fast (multi_instance)
  stale UnityLockfile → preflight error (project_locked)

BUILD PROFILE (Unity 6+ only):
  --build-profile requires --batch (or editor not running).
  IPC lane rejects it: profile switch requires a domain reload.
  Path must be relative to project root and end in .asset.

EXIT CODES:
  0   success
  1   build failed
  2   param/validation error
  3   lane unavailable (editor_busy / project_locked / multi_instance / editor_running / editor_not_running / profile_switch_requires_batch)
  124 --wait client timeout while build continues
  125 unictl internal error`,
  },
  args: {
    target: { type: "string", description: "Unity BuildTarget (e.g. StandaloneWindows64, Android, iOS, WebGL)" },
    output: { type: "string", description: "Output path (default: derived from target + ProductName)" },
    scenes: { type: "string", description: "Comma-separated scene paths (default: EditorBuildSettings)" },
    define: { type: "string", description: "Comma-separated define symbols (e.g. DEBUG,API_URL=https://...)" },
    buildProfile: { type: "string", description: "Unity 6+ BuildProfile asset path (relative to project root, must end in .asset; batchmode only)" },
    development: { type: "boolean", default: false, description: "Development build" },
    allowDebugging: { type: "boolean", default: false, description: "Allow script debugging" },
    wait: { type: "boolean", default: true, description: "Block until terminal state (default: on)" },
    timeout: { type: "string", default: "0", description: "Client wait timeout in seconds (0 = unlimited)" },
    batch: { type: "boolean", default: false, description: "Force batchmode lane (errors if editor running)" },
    forceIpc: { type: "boolean", default: false, description: "Force IPC lane even when editor is flagged (see lane routing notes)" },
    jobId: { type: "string", description: "Override auto-generated job_id" },
    method: { type: "string", description: "Project static build method to invoke, e.g. Namespace.Type.Method" },
    methodParam: { type: "string", description: "Custom build method parameter as key=value; repeatable in raw CLI usage" },
    methodParamsJson: { type: "string", description: "Path to a JSON object with custom build method parameters" },
    minExpectedDurationMs: { type: "string", default: "5000", description: "Mark custom method results suspicious if no terminal context report and elapsed time is below this threshold; 0 disables" },
    project: { type: "string", description: "Unity project path (auto-detected if omitted)" },
  },
  run: async ({ args, rawArgs }) => {
    // 1. 프로젝트 루트 결정
    const { projectRoot } = getProjectPaths(args.project);

    // 2. BuildParams 구성
    const jobId = args.jobId ?? crypto.randomUUID().replace(/-/g, "");
    const timeoutSec = parseInt(args.timeout ?? "0", 10) || 0;
    const minExpectedDurationMs = parseInt(args.minExpectedDurationMs ?? "5000", 10);
    if (Number.isNaN(minExpectedDurationMs) || minExpectedDurationMs < 0) {
      errorExit(2, "invalid_param", "--min-expected-duration-ms must be a non-negative integer", "unictl build --method Namespace.Type.Method --min-expected-duration-ms 5000");
    }

    // --build-profile 유효성 검사
    let resolvedBuildProfile: string | undefined;
    if (args.buildProfile) {
      const raw = args.buildProfile as string;
      // Reject UNC paths explicitly. Unity batchmode behavior on `\\server\share\...` is undefined
      // after CLI normalizes backslashes to forward slashes.
      if (raw.startsWith("\\\\") || raw.startsWith("//")) {
        errorExit(
          2,
          "profile_invalid_path",
          `--build-profile UNC paths are not supported: "${raw}"`,
          "BuildProfile path must be a local filesystem path inside the project root, not a UNC share."
        );
      }
      if (!raw.endsWith(".asset")) {
        errorExit(
          2,
          "profile_invalid_extension",
          `--build-profile path must end with .asset: "${raw}"`,
          "BuildProfile path must end with .asset. Pass an asset path, not a directory or label."
        );
      }
      // 절대 경로 → 프로젝트 루트 기준 상대 경로로 변환
      let relPath: string;
      if (isAbsolute(raw)) {
        relPath = relative(projectRoot, raw).replace(/\\/g, "/");
      } else {
        relPath = raw.replace(/\\/g, "/");
      }
      // 경로 traversal 방지 — 프로젝트 루트 외부 경로 거부
      const absPath = resolve(projectRoot, relPath);
      if (!existsSync(absPath)) {
        errorExit(
          2,
          "profile_not_found",
          `BuildProfile asset not found: "${absPath}" (resolved from "${raw}")`,
          "BuildProfile asset not found at the given path. Verify path relative to project root."
        );
      }
      // Canonicalize via realpath to defeat junction/symlink/reparse-point escapes
      let realAbsPath: string;
      let realProjectRoot: string;
      try {
        realAbsPath = realpathSync.native(absPath);
        realProjectRoot = realpathSync.native(projectRoot);
      } catch (err) {
        errorExit(
          2,
          "profile_invalid_path",
          `--build-profile path could not be canonicalized: "${absPath}" (${(err as Error).message})`,
          "BuildProfile path could not be resolved. Verify path exists and is accessible."
        );
      }
      // Normalize separators for comparison
      const realAbsNorm = realAbsPath.replace(/\\/g, "/");
      const realRootNorm = realProjectRoot.replace(/\\/g, "/");
      if (realAbsNorm !== realRootNorm && !realAbsNorm.toLowerCase().startsWith(realRootNorm.toLowerCase() + "/")) {
        errorExit(
          2,
          "profile_invalid_path",
          `--build-profile resolves outside the project root after canonicalization: "${realAbsPath}"`,
          "BuildProfile path must resolve inside the project root. Symlinks and junctions are not permitted to escape."
        );
      }
      resolvedBuildProfile = relPath;
    }

    const buildParams: Record<string, unknown> = {
      job_id: jobId,
      timeout_sec: timeoutSec,
    };
    if (args.target) buildParams.target = args.target;
    if (args.output) buildParams.build_path = args.output;
    if (args.scenes) buildParams.scenes = args.scenes;
    if (args.define) buildParams.define_symbols = args.define;
    if (resolvedBuildProfile) buildParams.build_profile = resolvedBuildProfile;
    if (args.method) {
      buildParams.custom_method = args.method;
      buildParams.min_expected_duration_ms = minExpectedDurationMs;
      const methodParams = {
        ...(args.methodParamsJson ? readMethodParamsJson(args.methodParamsJson) : {}),
        ...parseMethodParams(rawArgs),
      };
      if (Object.keys(methodParams).length > 0) buildParams.method_params = methodParams;
    }
    if (args.development || args.allowDebugging) {
      buildParams.options = {
        development: args.development ?? false,
        allow_debugging: args.allowDebugging ?? false,
      };
    }

    // 3. Lane 결정
    const pid = await getUnityPid(projectRoot);
    const forceBatch = args.batch ?? false;
    const forceIpc = args.forceIpc ?? false;

    // --batch + 에디터 실행 중 → 에러
    if (forceBatch && pid !== null) {
      errorExit(
        3,
        "editor_running",
        `Unity editor is running (pid=${pid}). Stop it before using --batch, or omit --batch to use IPC lane.`,
        "editor is running; quit it first or omit --batch to use IPC lane"
      );
    }
    // --force-ipc + 에디터 없음 → 에러
    if (forceIpc && pid === null) {
      errorExit(
        3,
        "editor_not_running",
        "Unity editor is not running. Start it first with: unictl editor open",
        "editor is not running; open it first with: unictl editor open"
      );
    }

    // 다중 인스턴스 감지 (batchmode worker 제외)
    const allUnity = listUnityProcesses();
    const editorProcesses = allUnity.filter((p) => !isBatchModeWorker(p.command) && isUnityProcessForProject(p.command, projectRoot));
    if (editorProcesses.length > 1) {
      const pids = editorProcesses.map((p) => p.pid).join(", ");
      errorExit(
        3,
        "multi_instance",
        `Multiple Unity editor instances detected (pids: ${pids}). Quit extras before building.`,
        "multiple editors detected; quit extras before building"
      );
    }

    let lane: "ipc" | "batch";
    if (forceBatch) lane = "batch";
    else if (forceIpc) lane = "ipc";
    else lane = pid !== null ? "ipc" : "batch";

    // 4. Batchmode lane: UnityLockfile preflight
    if (lane === "batch") {
      const lockfile = getUnityLockfilePath(projectRoot);
      if (existsSync(lockfile)) {
        errorExit(
          3,
          "project_locked",
          `Unity lockfile exists: ${lockfile}. Another Unity instance may be using this project.`,
          "stale UnityLockfile; remove it or run: unictl editor quit"
        );
      }
    }

    // 5. IPC lane
    if (lane === "ipc") {
      let result: unknown;
      try {
        result = await command("build_project", buildParams, { project: projectRoot });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        errorExit(125, "ipc_error", `IPC call failed: ${msg}`);
      }

      const r = result as Record<string, unknown>;
      // 에러 응답이면 적절한 exit code로 종료
      if (r && r.success === false) {
        const err = r.data as Record<string, unknown> | undefined;
        const kind = (err?.kind as string) ?? "unknown";
        // lane 불가 에러 → exit 3
        const laneErrors = new Set(["editor_busy", "project_locked", "multi_instance", "target_unsupported", "profile_switch_requires_batch"]);
        const code = laneErrors.has(kind) ? 3 : 2;
        process.stderr.write(JSON.stringify(r) + "\n");
        process.exit(code);
      }

      const data = r?.data as Record<string, unknown> | undefined;
      const returnedJobId = (data?.job_id as string) ?? jobId;
      const progressPath = join(projectRoot, "Library", "unictl-builds", `${returnedJobId}.json`);

      if (!(args.wait ?? true)) {
        process.stdout.write(JSON.stringify(r) + "\n");
        return;
      }

      // --wait: progress 파일 폴링
      await pollUntilTerminal(progressPath, returnedJobId, timeoutSec);
      return;
    }

    // 6. Batchmode lane
    const buildsDir = getBuildsDir(projectRoot);
    mkdirSync(buildsDir, { recursive: true });

    const paramsPath = join(buildsDir, `${jobId}.params.json`);
    writeFileSync(paramsPath, JSON.stringify(buildParams), "utf-8");

    const unityVersion = readUnityVersion(projectRoot);
    const unityBin = resolveUnityBinary(unityVersion);
    const logPath = join(buildsDir, `${jobId}.log`);

    if (!existsSync(unityBin)) {
      errorExit(125, "unity_not_found", `Unity binary not found: ${unityBin}`);
    }

    const env = { ...process.env, UNICTL_BUILD_PARAMS_PATH: paramsPath };

    // -quit を削除: BuildFromCli は OneShot 콜백에서 EditorApplication.Exit()를 직접 호출.
    // -quit 가 있으면 executeMethod 반환 즉시 Unity가 종료되어 OneShot 발화 전에 exit됨.
    const unityArgs = [
      unityBin,
      "-batchmode",
      "-projectPath", projectRoot,
    ];
    // M4: verify Unity version supports BuildProfile (requires 6000.0+) before passing -activeBuildProfile
    if (resolvedBuildProfile) {
      const ver = unityVersion;
      if (ver) {
        const major = parseInt(ver.split(".")[0], 10);
        if (!isNaN(major) && major < 6000) {
          errorExit(
            2,
            "profile_unsupported_on_this_unity",
            `Unity version '${ver}' does not support BuildProfile (requires 6000.0+).`,
            "BuildProfile requires Unity 6000.0+. Remove --build-profile or upgrade editor."
          );
        }
      }
    }
    // -activeBuildProfile must be placed before -executeMethod so Unity applies
    // the profile during project load, before scripts run (Unity 6+ only).
    if (resolvedBuildProfile) {
      unityArgs.push("-activeBuildProfile", resolvedBuildProfile);
    }
    unityArgs.push("-executeMethod", "Unictl.Editor.BuildEntry.BuildFromCli");
    unityArgs.push("-logFile", logPath);

    const proc = Bun.spawn(
      unityArgs,
      { env, stdio: ["ignore", "ignore", "ignore"] }
    );

    if (!(args.wait ?? true)) {
      proc.unref();
      process.stdout.write(
        JSON.stringify({
          ok: true,
          job_id: jobId,
          state: "queued",
          terminal: false,
          lane: "batch",
          progress_file: join(buildsDir, `${jobId}.json`),
          log_file: logPath,
          pid: proc.pid,
          status_command: `unictl build status --job-id ${jobId}`,
          cancel_command: `unictl build cancel --job-id ${jobId}`,
          poll_interval_ms: 500,
          terminal_states: ["succeeded", "failed", "cancelled"],
        }) + "\n"
      );
      return;
    }

    // --wait: 자식 프로세스 exit 대기 + 병렬로 progress file polling (state streaming)
    // IPC lane과 달리 batch cold start = 15-60초이므로 grace period 없이 proc.exited 기준으로 대기
    const progressPath = join(buildsDir, `${jobId}.json`);
    const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : Infinity;

    // 병렬 poll: progress file이 생기면 state 전이를 stdout에 스트리밍 (grace period 없음)
    let lastState: string | null = null;
    const pollInterval = setInterval(() => {
      if (!existsSync(progressPath)) return;
      try {
        const obj = normalizeBuildProgress(JSON.parse(readFileSync(progressPath, "utf-8").replace(/^﻿/, "")) as Record<string, unknown>, jobId);
        const state = obj.state as string;
        if (state !== lastState) {
          process.stdout.write(JSON.stringify(filterLifecycleSummary(obj, jobId)) + "\n");
          lastState = state;
        }
      } catch {
        // JSON 파싱 실패 (파일 mid-write) — 다음 tick에 재시도
      }
    }, 500);

    // Timeout watcher
    const timeoutTimer = timeoutSec > 0 ? setTimeout(() => {
      clearInterval(pollInterval);
      process.stderr.write(JSON.stringify({
        ok: false,
        error: {
          kind: "timeout",
          message: `CLI wait timeout (${timeoutSec}s) reached; Unity batch still running (pid=${proc.pid}).`,
          hint: "poll: unictl build status --job-id " + jobId,
        },
      }) + "\n");
      process.exit(124);
    }, timeoutSec * 1000) : null;

    // Unity 자식 프로세스 종료 대기
    const exitCode = await proc.exited;
    clearInterval(pollInterval);
    if (timeoutTimer) clearTimeout(timeoutTimer);

    // 최종 progress file 읽기
    if (existsSync(progressPath)) {
      const final = normalizeBuildProgress(JSON.parse(readFileSync(progressPath, "utf-8").replace(/^﻿/, "")) as Record<string, unknown>, jobId);
      // 마지막 상태가 아직 출력 안 됐으면 출력
      if ((final.state as string) !== lastState) {
        process.stdout.write(JSON.stringify(filterLifecycleSummary(final, jobId)) + "\n");
      }
      process.exit(final.state === "succeeded" ? 0 : 1);
    } else {
      // Unity가 progress file 작성 전에 종료 — 빌드 경로에 진입하지 못함
      process.stderr.write(JSON.stringify({
        ok: false,
        error: {
          kind: "build_exception",
          message: `Unity batch exited (code=${exitCode}) without writing progress file. Check log: ${logPath}`,
          hint: "read Unity batch log; verify BuildEntry.BuildFromCli compiled and accessible",
        },
      }) + "\n");
      process.exit(exitCode ?? 1);
    }
  },
});
