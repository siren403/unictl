import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import {
  endpointSeemsPresent,
  fetchEndpoint,
  getProjectPaths,
  hasEndpointFile,
  readEndpointDescriptor,
  resolveEndpointDescriptor,
  type EndpointDescriptor,
} from "./socket";
import { createIpcRequestMeta } from "./ipc-meta";
import {
  getUnityPid,
  killProcess,
  readUnityVersion,
  resolveUnityBinary,
} from "./process";
import { getProjectEditorLogFiles } from "./log-paths";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProjectRoot(projectPath?: string): string {
  const { projectRoot } = getProjectPaths(projectPath);
  return projectRoot;
}

export type EditorStatusResult = {
  running: boolean;
  pid: number | null;
  endpoint: boolean;
  transport: EndpointDescriptor["transport"];
  socket: boolean;
  health: unknown | null;
  reachable: boolean;
  phase: string | null;
  state_reachable: boolean;
  liveness_reachable: boolean;
  is_playing: boolean | null;
  is_in_playmode: boolean | null;
  is_compiling: boolean | null;
  is_paused: boolean | null;
  is_reloading_domain: boolean | null;
  is_importing_assets: boolean | null;
  is_busy: boolean;
  busy_reasons: string[];
  alive_ms_ago: number | null;
  last_heartbeat_ms: number | null;
  stale: boolean;
  domain_reload: unknown | null;
  run_in_background: boolean | null;
  unity_version: string | null;
  platform: string | null;
  compile_lifecycle?: unknown;
  unictl?: unknown;
  diagnostics?: {
    state_error?: string;
    liveness_error?: string;
  };
};

type EditorControlStatusData = {
  is_playing?: boolean;
  is_compiling?: boolean;
  is_paused?: boolean;
  domain_reload?: unknown;
  run_in_background?: boolean;
  unity_version?: string;
  platform?: string;
  compile_lifecycle?: unknown;
  unictl?: unknown;
};

type EditorControlStatusResponse = {
  success?: boolean;
  data?: EditorControlStatusData;
  message?: string;
  error?: { message?: string };
};

type LivenessResponse = {
  alive_ms_ago?: number;
  last_heartbeat_ms?: number;
  last_state?: {
    phase?: string;
    is_playing?: boolean;
    is_compiling?: boolean;
    is_paused?: boolean;
    unity_version?: string;
    platform?: string;
  };
  handler_registered?: boolean;
  phase_override?: "never_seen" | "unresponsive" | null;
};

function endpointIsReachable(endpoint: EndpointDescriptor): boolean {
  return endpointSeemsPresent(endpoint);
}

/** Try /health endpoint, returns parsed JSON or null. */
async function tryHealth(endpoint: EndpointDescriptor): Promise<unknown | null> {
  try {
    const res = await fetchEndpoint(endpoint, "/health");
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Try /liveness endpoint, returns parsed JSON or null. */
async function tryLiveness(endpoint: EndpointDescriptor): Promise<LivenessResponse | null> {
  try {
    const res = await fetchEndpoint(endpoint, "/liveness");
    if (!res.ok) return null;
    return await res.json() as LivenessResponse;
  } catch {
    return null;
  }
}

/** Send editor_control command. Returns response or throws. */
async function sendEditorControl(
  endpoint: EndpointDescriptor,
  params: Record<string, string>
): Promise<unknown> {
  const requestId = crypto.randomUUID();
  const res = await fetchEndpoint(endpoint, "/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: requestId,
      command: "editor_control",
      params: {
        ...params,
        _meta: createIpcRequestMeta(endpoint, requestId),
      },
    }),
  });
  return res.json();
}

function boolOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function effectiveLivenessPhase(liveness: LivenessResponse | null): string | null {
  if (!liveness) return null;
  if (liveness.phase_override === "unresponsive") return "unresponsive";
  if (liveness.phase_override === "never_seen") return "never_seen";
  return typeof liveness.last_state?.phase === "string" ? liveness.last_state.phase : null;
}

/** Clean Temp/__Backupscenes/ to avoid scene recovery popup. */
function cleanBackupScenes(projectRoot: string): void {
  const backupDir = join(projectRoot, "Temp", "__Backupscenes");
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// pre-compile check
// ---------------------------------------------------------------------------

async function precompileCheck(
  unityBin: string,
  projectRoot: string
): Promise<{ success: boolean; errors: string[] }> {
  const logFile = join(projectRoot, "Temp", "unictl-precompile.log");

  const proc = Bun.spawn(
    [unityBin, "-batchmode", "-quit", "-projectPath", projectRoot, "-logFile", logFile],
    { stdio: ["ignore", "ignore", "ignore"] }
  );
  await proc.exited;
  const exitCode = proc.exitCode;

  if (exitCode === 0) {
    return { success: true, errors: [] };
  }

  let errors: string[] = [];
  if (existsSync(logFile)) {
    const log = readFileSync(logFile, "utf-8");
    errors = log
      .split("\n")
      .filter((line) => /error\s+CS\d{4}/i.test(line))
      .slice(0, 20);
  }

  return {
    success: false,
    errors: errors.length > 0 ? errors : [`Unity exited with code ${exitCode}. Check ${logFile}`],
  };
}

// ---------------------------------------------------------------------------
// editor status
// ---------------------------------------------------------------------------

export async function editorStatus(opts?: { project?: string }): Promise<EditorStatusResult> {
  const endpointFile = hasEndpointFile(opts?.project);
  const endpoint = resolveEndpointDescriptor(opts?.project);
  const pid = await getUnityPid(opts?.project);
  const endpointPresent = endpointIsReachable(endpoint);
  const healthData = endpointPresent ? await tryHealth(endpoint) : null;
  const healthRecord = healthData && typeof healthData === "object" ? healthData as Record<string, unknown> : null;
  const livenessData = endpointPresent ? await tryLiveness(endpoint) : null;
  const diagnostics: NonNullable<EditorStatusResult["diagnostics"]> = {};

  let stateData: EditorControlStatusData | null = null;
  if (endpointPresent && healthRecord?.handler_registered === true) {
    try {
      const stateResp = await sendEditorControl(endpoint, { action: "status" }) as EditorControlStatusResponse;
      if (stateResp?.success === true && stateResp.data && typeof stateResp.data === "object") {
        stateData = stateResp.data;
      } else {
        diagnostics.state_error =
          stateResp?.error?.message ?? stateResp?.message ?? "editor_control status did not return success=true";
      }
    } catch (e) {
      diagnostics.state_error = e instanceof Error ? e.message : String(e);
    }
  }

  const lastState = livenessData?.last_state;
  const livenessPhase = effectiveLivenessPhase(livenessData);
  const statePhase = (stateData?.is_compiling === true ? "compiling" : null)
    ?? (stateData?.is_playing === true ? "playing" : null)
    ?? (stateData ? "idle" : null);
  const phase = livenessPhase === "unresponsive" && statePhase !== null
    ? statePhase
    : livenessPhase ?? statePhase;

  const isCompiling = boolOrNull(stateData?.is_compiling ?? lastState?.is_compiling);
  const isPlaying = boolOrNull(stateData?.is_playing ?? lastState?.is_playing);
  const isPaused = boolOrNull(stateData?.is_paused ?? lastState?.is_paused);
  const isReloadingDomain = phase === "reloading";
  const isImportingAssets = null;
  const isInPlaymode = isPlaying === true || phase === "playing" || phase === "paused";

  const busyReasons: string[] = [];
  if (isCompiling === true || phase === "compiling") busyReasons.push("compiling");
  if (isReloadingDomain) busyReasons.push("reloading_domain");
  if (isImportingAssets === true) busyReasons.push("importing_assets");
  if (isInPlaymode) busyReasons.push("playmode");

  const reachable = endpointPresent && healthRecord?.handler_registered === true;
  const stateReachable = stateData !== null;
  const livenessReachable = livenessData !== null;
  if (endpointPresent && !livenessReachable) diagnostics.liveness_error = "liveness endpoint unavailable";

  return {
    running: pid !== null,
    pid,
    endpoint: endpointFile,
    transport: endpoint.transport,
    socket: endpoint.transport === "unix" ? endpointPresent : false,
    health: healthData ?? null,
    reachable,
    phase,
    state_reachable: stateReachable,
    liveness_reachable: livenessReachable,
    is_playing: isPlaying,
    is_in_playmode: isInPlaymode,
    is_compiling: isCompiling,
    is_paused: isPaused,
    is_reloading_domain: isReloadingDomain,
    is_importing_assets: isImportingAssets,
    is_busy: busyReasons.length > 0,
    busy_reasons: busyReasons,
    alive_ms_ago: typeof livenessData?.alive_ms_ago === "number" ? livenessData.alive_ms_ago : null,
    last_heartbeat_ms: typeof livenessData?.last_heartbeat_ms === "number" ? livenessData.last_heartbeat_ms : null,
    stale: livenessData?.phase_override === "unresponsive",
    domain_reload: stateData?.domain_reload ?? null,
    run_in_background: boolOrNull(stateData?.run_in_background),
    unity_version: stringOrNull(stateData?.unity_version ?? lastState?.unity_version),
    platform: stringOrNull(stateData?.platform ?? lastState?.platform),
    ...(stateData?.compile_lifecycle !== undefined ? { compile_lifecycle: stateData.compile_lifecycle } : {}),
    ...(stateData?.unictl !== undefined ? { unictl: stateData.unictl } : {}),
    ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
  };
}

// ---------------------------------------------------------------------------
// editor quit
// ---------------------------------------------------------------------------

export async function editorQuit(opts?: {
  project?: string;
  force?: boolean;
  gracefulTimeoutMs?: number;
}): Promise<unknown> {
  const endpoint = resolveEndpointDescriptor(opts?.project);

  if (!endpointIsReachable(endpoint)) {
    throw new Error("Unity editor endpoint not found — editor may not be running");
  }

  // Send quit command
  try {
    await sendEditorControl(endpoint, { action: "quit" });
  } catch {
    // Endpoint closed immediately on quit — treat as success signal
  }

  // Poll PID — single source of truth for "is the editor really gone?". Endpoint
  // cleanup is unreliable: the named-pipe descriptor file can disappear during
  // Unity's graceful shutdown sequence while the process itself is still alive
  // (saving caches, finishing asset import). Treating that as quit:true would
  // be a false positive. PID-gone is the only signal that proves termination.
  const gracefulCeiling = opts?.gracefulTimeoutMs ?? 15_000;
  const timeout = Date.now() + gracefulCeiling;
  while (Date.now() < timeout) {
    await sleep(200);
    if ((await getUnityPid(opts?.project)) === null) {
      return { quit: true };
    }
  }

  // Graceful quit timeout — auto-force kill
  // EditorApplication.Exit(0)가 unfocused에서 실행되지 않으므로 SIGTERM 폴백 필수
  const pid = await getUnityPid(opts?.project);
  if (pid !== null) {
    killProcess(pid, false);
    await sleep(3_000);
    const stillRunning = await getUnityPid(opts?.project);
    if (stillRunning !== null) {
      killProcess(pid, true);
      await sleep(1_000);
    }
  }
  return { quit: true };
}

// ---------------------------------------------------------------------------
// editor open
// ---------------------------------------------------------------------------

export async function editorOpen(opts?: {
  project?: string;
  skipPrecompile?: boolean;
}): Promise<unknown> {
  const projectRoot = getProjectRoot(opts?.project);

  // Refuse if already running
  const existingPid = await getUnityPid(opts?.project);
  if (existingPid !== null) {
    const err = new Error(`Unity editor is already running (pid=${existingPid})`);
    (err as any).kind = "editor_running";
    (err as any).pid = existingPid;
    throw err;
  }

  // Clean backup scenes to avoid recovery popup
  cleanBackupScenes(projectRoot);

  // Determine Unity version and binary path
  const version = readUnityVersion(projectRoot);
  const unityBin = resolveUnityBinary(version);

  if (!existsSync(unityBin)) {
    throw new Error(`Unity binary not found: ${unityBin}`);
  }

  // Pre-compile check: run Unity in batch mode to detect compile errors
  if (!opts?.skipPrecompile) {
    const precompileResult = await precompileCheck(unityBin, projectRoot);
    if (!precompileResult.success) {
      throw new Error(
        `Pre-compile check failed. Fix errors before opening:\n${precompileResult.errors.join("\n")}`
      );
    }
  }

  const logFiles = getProjectEditorLogFiles(projectRoot);
  mkdirSync(logFiles.state_dir, { recursive: true });

  // Launch Unity (fully detached so interrupt won't kill it)
  const proc = Bun.spawn([
    unityBin,
    "-projectPath", projectRoot,
    "-logFile", logFiles.editor_log_file,
    "-upmLogFile", logFiles.upm_log_file,
  ], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const launchedPid = proc.pid;
  proc.unref();

  // Poll /health until responsive (2s interval, 120s timeout)
  const timeout = Date.now() + 120_000;
  while (Date.now() < timeout) {
    await sleep(2_000);
    try {
      const endpoint = readEndpointDescriptor(opts?.project) ?? resolveEndpointDescriptor(opts?.project);
      if (endpointIsReachable(endpoint)) {
        const healthData = await tryHealth(endpoint);
        if (healthData !== null) {
          return {
            opened: true,
            pid: launchedPid,
            editor_log_file: logFiles.editor_log_file,
            upm_log_file: logFiles.upm_log_file,
            log_scope: logFiles.log_scope,
          };
        }
      }
    } catch {
      // pipe not ready yet, continue polling
    }
  }

  throw new Error("Timeout waiting for Unity editor to become ready (120s)");
}

// ---------------------------------------------------------------------------
// editor restart
// ---------------------------------------------------------------------------

export async function editorRestart(opts?: { project?: string }): Promise<unknown> {
  const endpoint = resolveEndpointDescriptor(opts?.project);

  // Quit (force if needed)
  if (endpointIsReachable(endpoint)) {
    try {
      await editorQuit({ project: opts?.project, force: false });
    } catch {
      // Quit timed out — force kill
      await editorQuit({ project: opts?.project, force: true });
    }
  }

  // Small buffer to ensure OS releases the socket
  await sleep(500);

  const result = (await editorOpen({ project: opts?.project })) as { opened: boolean; pid: number };
  return { restarted: true, pid: result.pid };
}
