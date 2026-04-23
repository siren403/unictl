import { defineCommand } from "citty";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getProjectPaths } from "./socket";
import { getUnityPid, listUnityProcesses, isBatchModeWorker, readUnityVersion, resolveUnityBinary } from "./process";
import { command } from "./client";

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

function errorExit(code: number, kind: string, message: string, hint?: string): never {
  process.stderr.write(JSON.stringify({ ok: false, error: { kind, message, hint: hint ?? "" } }) + "\n");
  process.exit(code);
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
            message: `CLI wait timeout reached; build still in progress. Poll with: unictl command build_status -p job_id=${jobId}`,
            hint: `poll: unictl command build_status -p job_id=${jobId}`,
          },
        }) + "\n"
      );
      process.exit(124);
    }

    try {
      const raw = readFileSync(progressPath, "utf-8").replace(/^﻿/, "");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const state = obj.state as string;

      // 상태 변경 시에만 출력
      if (state !== lastState) {
        process.stdout.write(JSON.stringify({ job_id: jobId, state, ...filterSummary(obj) }) + "\n");
        lastState = state;
      }

      if (state === "done") process.exit(0);
      if (state === "failed" || state === "aborted") {
        process.exit(1);
      }
    } catch {
      // §2.4 reader retry — JSON 파싱 실패 시 재시도
    }

    await sleep(500);
  }
}

/** done/failed 시 report_summary + error 필드만 추출 */
function filterSummary(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj.report_summary) out.report_summary = obj.report_summary;
  if (obj.error) out.error = obj.error;
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

LANE ROUTING:
  editor running + low hook_risk    → IPC lane (fast path)
  editor running + hook_risk=high   → Batchmode (unless --force-ipc)
  editor not running                → Batchmode lane
  multiple editors                  → fail-fast (multi_instance)
  stale UnityLockfile               → preflight error (project_locked)

EXIT CODES:
  0   success
  1   build failed
  2   param/validation error
  3   lane unavailable (editor_busy / project_locked / multi_instance / editor_running / editor_not_running)
  124 --wait client timeout while build continues
  125 unictl internal error`,
  },
  args: {
    target: { type: "string", description: "Unity BuildTarget (e.g. StandaloneWindows64, Android, iOS, WebGL)" },
    output: { type: "string", description: "Output path (default: derived from target + ProductName)" },
    scenes: { type: "string", description: "Comma-separated scene paths (default: EditorBuildSettings)" },
    define: { type: "string", description: "Comma-separated define symbols (e.g. DEBUG,API_URL=https://...)" },
    buildProfile: { type: "string", description: "Unity 6+ BuildProfile asset path" },
    development: { type: "boolean", default: false, description: "Development build" },
    allowDebugging: { type: "boolean", default: false, description: "Allow script debugging" },
    wait: { type: "boolean", default: true, description: "Block until terminal state (default: on)" },
    timeout: { type: "string", default: "0", description: "Client wait timeout in seconds (0 = unlimited)" },
    batch: { type: "boolean", default: false, description: "Force batchmode lane (errors if editor running)" },
    forceIpc: { type: "boolean", default: false, description: "Override hook_risk=high auto-fallback" },
    jobId: { type: "string", description: "Override auto-generated job_id" },
    project: { type: "string", description: "Unity project path (auto-detected if omitted)" },
  },
  run: async ({ args }) => {
    // 1. 프로젝트 루트 결정
    const { projectRoot } = getProjectPaths(args.project);

    // 2. BuildParams 구성
    const jobId = args.jobId ?? crypto.randomUUID().replace(/-/g, "");
    const timeoutSec = parseInt(args.timeout ?? "0", 10) || 0;

    const buildParams: Record<string, unknown> = {
      job_id: jobId,
      timeout_sec: timeoutSec,
    };
    if (args.target) buildParams.target = args.target;
    if (args.output) buildParams.build_path = args.output;
    if (args.scenes) buildParams.scenes = args.scenes;
    if (args.define) buildParams.define_symbols = args.define;
    if (args.buildProfile) buildParams.build_profile = args.buildProfile;
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
    const editorProcesses = allUnity.filter((p) => !isBatchModeWorker(p.command));
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
      const lockfile = join(projectRoot, "Library", "UnityLockfile");
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
        const laneErrors = new Set(["editor_busy", "project_locked", "multi_instance", "lock_held", "prepare_required", "target_unsupported"]);
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
    const proc = Bun.spawn(
      [
        unityBin,
        "-batchmode",
        "-projectPath", projectRoot,
        "-executeMethod", "Unictl.Editor.BuildEntry.BuildFromCli",
        "-logFile", logPath,
      ],
      { env, stdio: ["ignore", "ignore", "ignore"] }
    );

    if (!(args.wait ?? true)) {
      proc.unref();
      process.stdout.write(
        JSON.stringify({
          ok: true,
          job_id: jobId,
          lane: "batch",
          progress_file: join(buildsDir, `${jobId}.json`),
          log_file: logPath,
          pid: proc.pid,
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
        const obj = JSON.parse(readFileSync(progressPath, "utf-8").replace(/^﻿/, "")) as Record<string, unknown>;
        const state = obj.state as string;
        if (state !== lastState) {
          process.stdout.write(JSON.stringify({ job_id: jobId, state, ...filterSummary(obj) }) + "\n");
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
          hint: "poll: unictl command build_status -p job_id=" + jobId,
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
      const final = JSON.parse(readFileSync(progressPath, "utf-8").replace(/^﻿/, "")) as Record<string, unknown>;
      // 마지막 상태가 아직 출력 안 됐으면 출력
      if ((final.state as string) !== lastState) {
        process.stdout.write(JSON.stringify({ job_id: jobId, state: final.state, ...filterSummary(final) }) + "\n");
      }
      process.exit(final.state === "done" ? 0 : 1);
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
