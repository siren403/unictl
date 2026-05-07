#!/usr/bin/env bun
//MISE description="QA: kill editor → reopen → expect runtime.json.crashed sidecar"

import { TaskRunner, runUnictl, parseJsonLine, isEditorReachable, PROJECT_ROOT } from "../../qa-lib.ts";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const RUNTIME_DIR = join(PROJECT_ROOT, "Library/unictl");
const RUNTIME_PATH = join(RUNTIME_DIR, "runtime.json");

const t = new TaskRunner("qa:crash");

const reach = t.step("editor reachable");
if (!isEditorReachable()) {
  reach.skip("editor not reachable; start it with `unictl editor open` before running this task");
  t.finalize();
}
reach.pass();

// Step 1: snapshot current runtime.json so we can verify the sidecar after restart.
let prevPid: number;
let prevSessionId: string;
let prevStartedAtMs: number;
{
  const s = t.step("snapshot runtime.json (pre-crash)");
  if (!existsSync(RUNTIME_PATH)) { s.fail(`${RUNTIME_PATH} not found`); t.finalize(); }
  const j = JSON.parse(readFileSync(RUNTIME_PATH, "utf-8")) as { pid: number; session_id: string; started_at_ms: number; terminal_reason: string };
  prevPid = j.pid;
  prevSessionId = j.session_id;
  prevStartedAtMs = j.started_at_ms;
  if (j.terminal_reason !== "unknown") { s.fail(`expected terminal_reason='unknown' for live editor; got '${j.terminal_reason}'`, j); t.finalize(); }
  s.pass(`pid=${prevPid} session=${prevSessionId.slice(0, 8)}…`, { pid: prevPid, session_id: prevSessionId });
}

// Step 2: forcibly terminate the editor (simulating a crash).
{
  const s = t.step(`taskkill /F /PID ${prevPid}`);
  const cmd = process.platform === "win32"
    ? ["taskkill", "/F", "/PID", String(prevPid)]
    : ["kill", "-9", String(prevPid)];
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf-8" });
  if (r.status !== 0) { s.fail(`exit ${r.status}: ${r.stderr.slice(0, 200)}`); t.finalize(); }
  s.pass("editor process killed");
}

// Brief pause for Unity's process exit handlers — none should fire on SIGKILL,
// which is the whole point: terminal_reason stays "unknown" in the file.
await new Promise((r) => setTimeout(r, 2500));

// Step 3: confirm runtime.json still on disk with terminal_reason="unknown".
//         (Phase B4a only writes "quit" on the graceful EditorApplication.quitting
//         hook; SIGKILL skips that hook entirely.)
{
  const s = t.step("runtime.json still on disk after kill (no graceful quit write)");
  if (!existsSync(RUNTIME_PATH)) { s.fail("runtime.json deleted unexpectedly — only graceful quit should remove it"); t.finalize(); }
  const j = JSON.parse(readFileSync(RUNTIME_PATH, "utf-8")) as { pid: number; terminal_reason: string };
  if (j.pid !== prevPid) { s.fail(`pid changed before reopen; expected ${prevPid} got ${j.pid}`, j); t.finalize(); }
  if (j.terminal_reason !== "unknown") { s.fail(`terminal_reason should be 'unknown' (SIGKILL bypasses quit hook); got '${j.terminal_reason}'`, j); t.finalize(); }
  s.pass(`pid=${prevPid} terminal_reason='unknown'`, j);
}

// Step 4: spawn new editor (fire-and-forget). Don't wait for IPC readiness —
//         the sidecar file is what we're verifying, and Unity writes it
//         during [InitializeOnLoad] (B5 logic), which completes BEFORE the
//         IPC handler registers. Waiting for `--wait reachable` would
//         block on a downstream signal that arrives later than the actual
//         signal we care about.
{
  const s = t.step("unictl editor open (fire-and-forget spawn)");
  const r = runUnictl(["editor", "open"]);
  if (r.exitCode !== 0) { s.fail(`exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`); t.finalize(); }
  const j = parseJsonLine(r.stdout) as { opened?: boolean; pid?: number };
  if (!j.opened || !j.pid) { s.fail(`expected opened+pid; got ${JSON.stringify(j).slice(0, 200)}`); t.finalize(); }
  s.pass(`new pid=${j.pid}`, j);
}

// Step 5: poll for the crash sidecar file directly. This is the actual
//         signal under test — UnictlRuntimeJson.cs's B5 logic detects the
//         previous session's stale runtime.json (terminal_reason != quit
//         + dead PID) and writes the sidecar during [InitializeOnLoad].
//         5-minute ceiling covers worst-case Unity boot.
{
  const s = t.step("crash sidecar appears (poll, 5m ceiling)");
  const expectedName = `runtime.json.crashed.${prevPid}.${prevStartedAtMs}.json`;
  const expectedPath = join(RUNTIME_DIR, expectedName);
  const startedAt = Date.now();
  const ceiling = startedAt + 5 * 60_000;
  let found = false;
  while (Date.now() < ceiling) {
    if (existsSync(expectedPath)) { found = true; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!found) {
    s.fail(`sidecar '${expectedName}' missing after ${(Date.now() - startedAt) / 1000}s — B5 detection logic likely failed`);
    t.finalize();
  }
  const sidecar = JSON.parse(readFileSync(expectedPath, "utf-8")) as { pid: number; session_id: string; started_at_ms: number; terminal_reason?: string };
  if (sidecar.pid !== prevPid) { s.fail(`sidecar pid=${sidecar.pid} != expected ${prevPid}`, sidecar); t.finalize(); }
  if (sidecar.session_id !== prevSessionId) { s.fail(`sidecar session=${sidecar.session_id} != expected ${prevSessionId}`, sidecar); t.finalize(); }
  s.pass(`sidecar=${expectedName} after ${Date.now() - startedAt}ms`, {
    sidecar_name: expectedName,
    elapsed_ms: Date.now() - startedAt,
    recovered_pid: sidecar.pid,
    recovered_session: sidecar.session_id,
    recovered_terminal_reason: sidecar.terminal_reason ?? null,
  });
}
