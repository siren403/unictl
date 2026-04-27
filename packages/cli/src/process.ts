import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getProjectPaths } from "./socket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UnityProcess = {
  pid: number;
  command: string;
};

// ---------------------------------------------------------------------------
// Lockfile paths
// ---------------------------------------------------------------------------

/** Canonical Unity lockfile path (Unity 2022+/6). */
export function getUnityLockfilePath(projectRoot: string): string {
  return join(projectRoot, "Library", "UnityLockfile");
}

// ---------------------------------------------------------------------------
// Unity binary / version resolution
// ---------------------------------------------------------------------------

/** Resolve Unity editor binary path for a given version string. */
export function resolveUnityBinary(version: string): string {
  if (process.platform === "win32") {
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
export function readUnityVersion(projectRoot: string): string {
  const versionFile = join(projectRoot, "ProjectSettings", "ProjectVersion.txt");
  const content = readFileSync(versionFile, "utf-8");
  const match = content.match(/^m_EditorVersion:\s*(.+)$/m);
  if (!match) throw new Error("Could not parse m_EditorVersion from ProjectVersion.txt");
  return match[1].trim();
}

// ---------------------------------------------------------------------------
// Process enumeration
// ---------------------------------------------------------------------------

export function listUnityProcesses(): UnityProcess[] {
  if (process.platform === "win32") {
    return listUnityProcessesWindows();
  }
  return listUnityProcessesMac();
}

export function listUnityProcessesMac(): UnityProcess[] {
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

export function listUnityProcessesWindows(): UnityProcess[] {
  // Primary: PowerShell Get-CimInstance (wmic is deprecated/removed on Windows 11+ and Server 2022+)
  try {
    const cimResult = Bun.spawnSync([
      "powershell",
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'Unity*.exe' } | Select-Object ProcessId,CommandLine,ExecutablePath | ConvertTo-Json -Compress",
    ]);
    if (cimResult.exitCode === 0) {
      const cimOut = cimResult.stdout.toString().trim();
      // Empty output = zero Unity processes (valid result, not a failure).
      // Non-empty = parse. Either way, return — do NOT fall through to wmic.
      return cimOut ? parseCimJson(cimOut) : [];
    }
  } catch (_err) {
    // PowerShell itself missing or spawn failure — fall through to wmic legacy fallback.
  }

  // Fallback: legacy wmic (may not exist on modern Windows). ENOENT = zero processes.
  try {
    return listUnityProcessesWmic();
  } catch (_err) {
    // wmic not found or spawn failure. CIM already failed above. Return empty list
    // instead of propagating an uncaught exception into doctor/editor/health paths.
    return [];
  }
}

function parseCimJson(raw: string): UnityProcess[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items
    .map((p) => {
      if (typeof p !== "object" || p === null) return null;
      const obj = p as Record<string, unknown>;
      const pid = Number(obj.ProcessId);
      if (Number.isNaN(pid)) return null;
      const command = typeof obj.CommandLine === "string" ? obj.CommandLine : "";
      return { pid, command };
    })
    .filter((proc): proc is UnityProcess => proc !== null);
}

function listUnityProcessesWmic(): UnityProcess[] {
  // wmic gives us PID and full command line including -projectPath
  const proc = Bun.spawnSync(["wmic", "process", "where",
    "name like 'Unity%.exe'", "get", "ProcessId,CommandLine", "/FORMAT:CSV"]);
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

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

export function isBatchModeWorker(command: string): boolean {
  return command.includes(" -batchMode ") || command.includes("AssetImportWorker");
}

export function killProcess(pid: number, force: boolean): void {
  if (process.platform === "win32") {
    const args = ["taskkill", "/PID", String(pid)];
    if (force) args.push("/F");
    Bun.spawnSync(args);
  } else {
    Bun.spawnSync(force ? ["kill", "-9", String(pid)] : ["kill", String(pid)]);
  }
}

/** Get the main Unity editor PID for this project, returns null if not running. */
export async function getUnityPid(projectPath?: string): Promise<number | null> {
  const { projectRoot } = getProjectPaths(projectPath);
  const processes = listUnityProcesses();

  // Normalize path separators for cross-platform matching
  const normalizedRoot = projectRoot.replace(/\\/g, "/");
  // Unity launches via Hub use lowercase `-projectpath`; some other launch paths use camelCase
  // `-projectPath`. Match case-insensitively for both flag name and project path (Windows is
  // case-insensitive for filesystem paths).
  const normalizedRootLower = normalizedRoot.toLowerCase();
  const matchingProject = processes.filter((proc) => {
    const cmdLower = proc.command.replace(/\\/g, "/").toLowerCase();
    return cmdLower.includes(`-projectpath ${normalizedRootLower}`)
      || cmdLower.includes(`-projectpath "${normalizedRootLower}"`);
  });

  const preferred = matchingProject.find((proc) => !isBatchModeWorker(proc.command));
  return preferred?.pid ?? null;
}
