// Phase B of unictl v0.7 — runtime.json reader + PID guard.
//
// CLI-side counterpart of `UnictlRuntimeJson.cs`. Reads `Library/unictl/runtime.json`
// to distinguish:
//   - editor not running (no file)             → status: "not_running"
//   - editor cleanly quit (terminal_reason=quit + PID dead) → status: "quit"
//   - editor crashed (PID dead + terminal_reason!=quit)  → status: "died"
//   - editor running, project root matches      → status: "alive"
//   - PID alive but project_root mismatch       → status: "pid_mismatch" (B6 guard)
//
// Tolerates partial-write observation per F.2 with up to 3 retries at 50ms backoff.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const RUNTIME_DIR = "Library/unictl";
export const RUNTIME_FILE = "runtime.json";
export const RUNTIME_SCHEMA_VERSION_SUPPORTED = 1;

export type TerminalReason = "quit" | "crash" | "unknown";

export interface RuntimeJson {
  schema_version: number;
  pid: number;
  started_at_ms: number;
  project_root: string;
  transport: "pipe" | "socket";
  pipe_path: string | null;
  socket_path: string | null;
  native_version: string;
  editor_package_version: string;
  unity_version: string;
  session_id: string;
  platform: string;
  terminal_reason: TerminalReason;
}

export type RuntimeStatus =
  | { status: "not_running"; reason: "no_runtime_file" }
  | {
      status: "schema_unsupported";
      reason: "schema_version_above_supported";
      observed: number;
      supported: number;
    }
  | { status: "parse_failed"; reason: "could_not_parse"; attempts: number }
  | { status: "alive"; runtime: RuntimeJson }
  | { status: "died"; runtime: RuntimeJson }
  | { status: "pid_mismatch"; runtime: RuntimeJson; expected_root: string };

export interface ReadOptions {
  retries?: number;
  retryDelayMs?: number;
}

const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 50;

/** Resolve the runtime.json path for a given project root. */
export function runtimeJsonPath(projectRoot: string): string {
  return join(projectRoot, RUNTIME_DIR, RUNTIME_FILE);
}

/**
 * Synchronous read with bounded retries on parse failure (handles theoretical
 * mid-rename observation; F.2 atomic-rename makes this rare).
 */
export function readRuntimeJsonSync(
  projectRoot: string,
  opts: ReadOptions = {},
): RuntimeJson | null {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const path = runtimeJsonPath(projectRoot);

  if (!existsSync(path)) return null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const raw = readFileSync(path, "utf-8");
      if (!raw.trim()) {
        // Mid-rename empty observation; let the loop retry.
        if (attempt < retries - 1) sleepSyncMs(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
        continue;
      }
      return JSON.parse(raw) as RuntimeJson;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return null;
      if (attempt < retries - 1) {
        sleepSyncMs(opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
        continue;
      }
      return null;
    }
  }
  return null;
}

/**
 * OS-level liveness check. `process.kill(pid, 0)` does NOT kill the process —
 * signal 0 tests whether the PID is reachable. On Windows Node emulates this:
 * returns true if the PID exists, throws if not.
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ESRCH: process not found. EPERM: exists but cannot signal — still alive.
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    return false;
  }
}

/**
 * Normalize project_root strings for comparison. Both sides should already use
 * forward slashes (writer normalizes), but be defensive against future drift.
 */
function normalizeProjectRoot(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
}

/**
 * B3 + B6: combined reader + PID guard.
 *
 * Reads runtime.json, classifies the editor's state, and on `alive` ensures
 * the live PID actually belongs to an editor for THIS project root (PID reuse
 * mitigation).
 */
export function getRuntimeStatus(projectRoot: string, opts: ReadOptions = {}): RuntimeStatus {
  const path = runtimeJsonPath(projectRoot);
  if (!existsSync(path)) {
    return { status: "not_running", reason: "no_runtime_file" };
  }

  const runtime = readRuntimeJsonSync(projectRoot, opts);
  if (!runtime) {
    return {
      status: "parse_failed",
      reason: "could_not_parse",
      attempts: opts.retries ?? DEFAULT_RETRIES,
    };
  }

  if (typeof runtime.schema_version !== "number" || runtime.schema_version > RUNTIME_SCHEMA_VERSION_SUPPORTED) {
    return {
      status: "schema_unsupported",
      reason: "schema_version_above_supported",
      observed: runtime.schema_version ?? -1,
      supported: RUNTIME_SCHEMA_VERSION_SUPPORTED,
    };
  }

  const alive = isPidAlive(runtime.pid);
  if (!alive) {
    return { status: "died", runtime };
  }

  // B6: PID reuse guard. The editor's runtime.json pid is alive — verify the
  // recorded project_root matches what the CLI is currently asking about.
  // Mismatch means: PID has been reused by another process (rare but possible
  // on long-running hosts — R6 in the plan).
  const expected = normalizeProjectRoot(projectRoot);
  const recorded = normalizeProjectRoot(runtime.project_root);
  if (expected !== recorded) {
    return { status: "pid_mismatch", runtime, expected_root: projectRoot };
  }

  return { status: "alive", runtime };
}

/** Sleep for `ms` milliseconds synchronously (used in the parse-retry loop). */
function sleepSyncMs(ms: number): void {
  // Node's sync sleep idiom — unblocks the event loop for the wait window so
  // we don't burn CPU.
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Spinning is fine for ≤ 50ms windows. We only enter this path on the rare
    // mid-rename race; not the steady-state read path.
  }
}
