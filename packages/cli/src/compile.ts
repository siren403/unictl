import { existsSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";
import { getProjectPaths } from "./socket";
import { getUnityPid, killProcess, readUnityVersion, resolveUnityBinary } from "./process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompileResult = {
  ok: boolean;
  success: boolean;
  exit_code: number;
  errors: string[];
  warnings: string[];
  log_file: string;
  duration_ms: number;
  unity_version: string;
};

// ---------------------------------------------------------------------------
// runCompile
// ---------------------------------------------------------------------------

/**
 * Unity를 batchmode로 실행해 컴파일 + .meta 파일 생성.
 * 에디터 없이 headless로 동작한다.
 */
export async function runCompile(opts?: {
  project?: string;
  timeout?: number;
  logFile?: string;
}): Promise<CompileResult> {
  const { projectRoot } = getProjectPaths(opts?.project);

  // Preflight: 에디터가 이미 실행 중이면 거부
  const runningPid = await getUnityPid(opts?.project);
  if (runningPid !== null) {
    const err = new Error(
      `Unity editor is already running (pid=${runningPid}). ` +
      `Stop the editor first, or use: unictl command editor_control -p action=refresh`
    );
    (err as any).kind = "editor_running";
    throw err;
  }

  // Preflight: UnityLockfile 존재 시 project_locked
  const lockFile = join(projectRoot, "Temp", "UnityLockfile");
  if (existsSync(lockFile)) {
    const err = new Error(
      `Unity lockfile exists: ${lockFile}. Another Unity instance may be using this project.`
    );
    (err as any).kind = "project_locked";
    (err as any).lock_file = lockFile;
    throw err;
  }

  // Unity 버전 + 바이너리 경로 결정
  const unityVersion = readUnityVersion(projectRoot);
  const unityBin = resolveUnityBinary(unityVersion);

  if (!existsSync(unityBin)) {
    throw new Error(`Unity binary not found: ${unityBin}`);
  }

  // 로그 파일 기본값
  const logFile = opts?.logFile
    ? resolve(opts.logFile)
    : join(projectRoot, "Temp", `unictl-compile-${Date.now()}.log`);

  const timeoutMs = opts?.timeout != null ? opts.timeout * 1000 : undefined;

  const startTime = Date.now();

  const proc = Bun.spawn(
    [unityBin, "-batchmode", "-quit", "-projectPath", projectRoot, "-logFile", logFile],
    { stdio: ["ignore", "ignore", "ignore"], detached: false }
  );

  // 타임아웃 처리
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        killProcess(proc.pid, true);
      } catch {
        // 프로세스가 이미 종료됐을 수 있음
      }
    }, timeoutMs);
  }

  await proc.exited;
  if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

  const durationMs = Date.now() - startTime;
  const exitCode = proc.exitCode ?? -1;

  if (timedOut) {
    const err = new Error(`Unity compile timed out after ${opts!.timeout}s`);
    (err as any).kind = "timeout";
    (err as any).duration_ms = durationMs;
    (err as any).log_file = logFile;
    throw err;
  }

  // 로그 파싱
  let errors: string[] = [];
  let warnings: string[] = [];

  if (existsSync(logFile)) {
    const log = readFileSync(logFile, "utf-8");
    const lines = log.split("\n");

    for (const line of lines) {
      if (/\berror\s+CS\d{4}\b/i.test(line)) {
        if (errors.length < 50) errors.push(line.trim());
      } else if (/\bwarning\s+CS\d{4}\b/i.test(line)) {
        if (warnings.length < 50) warnings.push(line.trim());
      }
    }
  }

  const success = exitCode === 0 && errors.length === 0;

  return {
    ok: exitCode !== -1,
    success,
    exit_code: exitCode,
    errors,
    warnings,
    log_file: logFile,
    duration_ms: durationMs,
    unity_version: unityVersion,
  };
}
