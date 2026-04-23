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
  const matchingProject = processes.filter((proc) => {
    const normalizedCmd = proc.command.replace(/\\/g, "/");
    return normalizedCmd.includes(`-projectPath ${normalizedRoot}`)
      || normalizedCmd.includes(`-projectPath "${normalizedRoot}"`);
  });

  const preferred = matchingProject.find((proc) => !isBatchModeWorker(proc.command));
  return preferred?.pid ?? null;
}
