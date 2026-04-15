import { existsSync, readFileSync, rmSync } from "fs";
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

type UnityProcess = {
  pid: number;
  command: string;
};

export type EditorStatusResult = {
  running: boolean;
  pid: number | null;
  endpoint: boolean;
  transport: EndpointDescriptor["transport"];
  socket: boolean;
  health: unknown | null;
};

function resolveUnityBinary(version: string): string {
  if (process.platform === "win32") {
    // Unity Hub default install paths on Windows
    const candidates = [
      `C:/Program Files/Unity/Hub/Editor/${version}/Editor/Unity.exe`,
      `C:/Program Files (x86)/Unity/Hub/Editor/${version}/Editor/Unity.exe`,
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return candidates[0]; // fallback — will trigger "not found" error
  }
  return `/Applications/Unity/Hub/Editor/${version}/Unity.app/Contents/MacOS/Unity`;
}

/** Parse m_EditorVersion from ProjectSettings/ProjectVersion.txt */
function readUnityVersion(projectRoot: string): string {
  const versionFile = join(projectRoot, "ProjectSettings", "ProjectVersion.txt");
  const content = readFileSync(versionFile, "utf-8");
  const match = content.match(/^m_EditorVersion:\s*(.+)$/m);
  if (!match) throw new Error("Could not parse m_EditorVersion from ProjectVersion.txt");
  return match[1].trim();
}

function listUnityProcesses(): UnityProcess[] {
  if (process.platform === "win32") {
    return listUnityProcessesWindows();
  }
  return listUnityProcessesMac();
}

function listUnityProcessesMac(): UnityProcess[] {
  const proc = Bun.spawnSync(["ps", "-axo", "pid=,command="]);
  const out = proc.stdout.toString();

  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      const pid = Number.parseInt(match[1], 10);
      const command = match[2];
      if (Number.isNaN(pid)) return null;
      return { pid, command };
    })
    .filter((proc): proc is UnityProcess => {
      if (!proc) return false;
      return proc.command.includes("/Unity.app/Contents/MacOS/Unity");
    });
}

function listUnityProcessesWindows(): UnityProcess[] {
  // wmic gives us PID and full command line including -projectPath
  const proc = Bun.spawnSync(["wmic", "process", "where",
    "name='Unity.exe'", "get", "ProcessId,CommandLine", "/FORMAT:CSV"]);
  const out = proc.stdout.toString();

  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Node,"))  // skip CSV header
    .map((line) => {
      // CSV format: Node,CommandLine,ProcessId
      const lastComma = line.lastIndexOf(",");
      if (lastComma < 0) return null;
      const pid = Number.parseInt(line.slice(lastComma + 1), 10);
      // skip "Node," prefix, take everything up to last comma as command
      const firstComma = line.indexOf(",");
      const command = line.slice(firstComma + 1, lastComma);
      if (Number.isNaN(pid)) return null;
      return { pid, command };
    })
    .filter((proc): proc is UnityProcess => proc !== null);
}

function isBatchModeWorker(command: string): boolean {
  return command.includes(" -batchMode ") || command.includes("AssetImportWorker");
}

function killProcess(pid: number, force: boolean): void {
  if (process.platform === "win32") {
    const args = ["taskkill", "/PID", String(pid)];
    if (force) args.push("/F");
    Bun.spawnSync(args);
  } else {
    Bun.spawnSync(force ? ["kill", "-9", String(pid)] : ["kill", String(pid)]);
  }
}

/** Get the main Unity editor PID for this project, returns null if not running. */
async function getUnityPid(projectPath?: string): Promise<number | null> {
  const projectRoot = getProjectRoot(projectPath);
  const processes = listUnityProcesses();

  // Normalize path separators for cross-platform matching
  const normalizedRoot = projectRoot.replace(/\\/g, "/");
  const matchingProject = processes.filter((proc) => {
    const normalizedCmd = proc.command.replace(/\\/g, "/");
    return normalizedCmd.includes(`-projectPath ${normalizedRoot}`)
      || normalizedCmd.includes(`-projectPath "${normalizedRoot}"`);
  });

  const preferred = matchingProject.find((proc) => !isBatchModeWorker(proc.command));
  return preferred?.pid ?? null;
}

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

/** Send editor_control command. Returns response or throws. */
async function sendEditorControl(
  endpoint: EndpointDescriptor,
  params: Record<string, string>
): Promise<unknown> {
  const res = await fetchEndpoint(endpoint, "/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      command: "editor_control",
      params,
    }),
  });
  return res.json();
}

/** Clean Temp/__Backupscenes/ to avoid scene recovery popup. */
function cleanBackupScenes(projectRoot: string): void {
  const backupDir = join(projectRoot, "Temp", "__Backupscenes");
  if (existsSync(backupDir)) {
    rmSync(backupDir, { recursive: true, force: true });
  }
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

  return {
    running: pid !== null,
    pid,
    endpoint: endpointFile,
    transport: endpoint.transport,
    socket: endpoint.transport === "unix" ? endpointPresent : false,
    health: healthData ?? null,
  };
}

// ---------------------------------------------------------------------------
// editor quit
// ---------------------------------------------------------------------------

export async function editorQuit(opts?: {
  project?: string;
  force?: boolean;
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

  // Poll until endpoint disappears (200ms interval, 15s timeout)
  const timeout = Date.now() + 15_000;
  while (Date.now() < timeout) {
    await sleep(200);
    const nextEndpoint = readEndpointDescriptor(opts?.project) ?? endpoint;
    if (!endpointIsReachable(nextEndpoint)) {
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

export async function editorOpen(opts?: { project?: string }): Promise<unknown> {
  const projectRoot = getProjectRoot(opts?.project);

  // Refuse if already running
  const existingPid = await getUnityPid(opts?.project);
  if (existingPid !== null) {
    throw new Error(`Unity editor is already running (pid=${existingPid})`);
  }

  // Clean backup scenes to avoid recovery popup
  cleanBackupScenes(projectRoot);

  // Determine Unity version and binary path
  const version = readUnityVersion(projectRoot);
  const unityBin = resolveUnityBinary(version);

  if (!existsSync(unityBin)) {
    throw new Error(`Unity binary not found: ${unityBin}`);
  }

  // Launch Unity (detached, background)
  const proc = Bun.spawn([unityBin, "-projectPath", projectRoot], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const launchedPid = proc.pid;

  // Poll /health until responsive (500ms interval, 120s timeout)
  const timeout = Date.now() + 120_000;
  while (Date.now() < timeout) {
    await sleep(500);
    const endpoint = readEndpointDescriptor(opts?.project) ?? resolveEndpointDescriptor(opts?.project);
    if (endpointIsReachable(endpoint)) {
      const healthData = await tryHealth(endpoint);
      if (healthData !== null) {
        return { opened: true, pid: launchedPid };
      }
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
