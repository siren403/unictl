#!/usr/bin/env bun
//MISE description="QA: A4 reload ceiling — restart editor with low threshold, expect unresponsive override"

import { TaskRunner, runUnictl, parseJsonLine, isEditorReachable, PROJECT_ROOT } from "../../qa-lib.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const RUNTIME_PATH = join(PROJECT_ROOT, "Library/unictl/runtime.json");

const t = new TaskRunner("qa:ceiling");

// This task verifies the A4 30s reload ceiling logic via env override:
// UNICTL_RELOAD_THRESHOLD_MS=1 in Unity's environment makes /liveness flip
// phase_override to "unresponsive" whenever alive_ms_ago > 1ms — which is
// effectively always, since heartbeat is 1Hz. The wait engine should then
// short-circuit any non-reachable target with kind: editor_unresponsive.

// Step 1: graceful quit of the current editor so we can relaunch with the env.
//         Skip if editor isn't running — this task is destructive enough that
//         we won't try to start one from scratch here.
{
  const s = t.step("editor reachable (precondition for graceful quit)");
  if (!isEditorReachable()) {
    s.skip("editor not reachable; start it manually before running this task");
    t.finalize();
  }
  s.pass();
}

{
  const s = t.step("unictl editor quit (graceful — for env-laden relaunch)");
  const r = runUnictl(["editor", "quit"]);
  if (r.exitCode !== 0) { s.fail(`exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`); t.finalize(); }
  s.pass();
}

// Wait for graceful shutdown to complete. UnictlRuntimeJson.cs B4a writes
// terminal_reason="quit" then B4b best-effort deletes the file. We poll for
// either outcome.
{
  const s = t.step("wait for graceful shutdown");
  const ceiling = Date.now() + 30_000;
  let cleared = false;
  while (Date.now() < ceiling) {
    if (!existsSync(RUNTIME_PATH)) { cleared = true; break; }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!cleared) { s.fail(`runtime.json still present after 30s — quit did not complete`); t.finalize(); }
  s.pass(`runtime.json removed after graceful quit`);
}

// Step 2: relaunch the editor with UNICTL_RELOAD_THRESHOLD_MS=1.
//         Bun's spawnSync inherits env via { ...process.env, ...opts.env },
//         and unictl's editor open spawns Unity with default env inheritance,
//         so the variable propagates all the way down to the Rust native
//         bridge that reads it at /liveness build time.
{
  const s = t.step("unictl editor open with UNICTL_RELOAD_THRESHOLD_MS=1");
  const r = runUnictl(["editor", "open"], { env: { UNICTL_RELOAD_THRESHOLD_MS: "1" } });
  if (r.exitCode !== 0) { s.fail(`exit ${r.exitCode}: ${r.stderr.slice(0, 200)}`); t.finalize(); }
  const j = parseJsonLine(r.stdout) as { opened?: boolean; pid?: number };
  if (!j.opened || !j.pid) { s.fail(`expected opened+pid; got ${JSON.stringify(j)}`); t.finalize(); }
  s.pass(`new pid=${j.pid}`, j);
}

// Step 3: wait for the IPC handler to register.
{
  const s = t.step("wait for handler registered");
  const startedAt = Date.now();
  const ceiling = startedAt + 120_000;
  let ok = false;
  while (Date.now() < ceiling) {
    if (isEditorReachable()) { ok = true; break; }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ok) { s.fail(`editor not reachable within ${(Date.now() - startedAt) / 1000}s`); t.finalize(); }
  s.pass(`reached after ${Date.now() - startedAt}ms`);
}

// Step 4: confirm /liveness reports phase_override="unresponsive". With
// threshold=1ms, any non-zero alive_ms_ago triggers it.
{
  const s = t.step("/liveness reports phase_override='unresponsive'");
  const { liveness } = await import("../../../packages/cli/src/client.ts");
  const resp = await liveness({ project: PROJECT_ROOT }) as { phase_override?: string; alive_ms_ago?: number };
  if (resp.phase_override !== "unresponsive") {
    s.fail(`expected phase_override=unresponsive (env injection failed?); got ${JSON.stringify(resp).slice(0, 200)}`, resp);
    t.finalize();
  }
  s.pass(`alive_ms_ago=${resp.alive_ms_ago}, override=unresponsive`, resp);
}

// Step 5: wait engine short-circuits with kind:editor_unresponsive when target
// is not "reachable". Use a tiny timeout because the engine should bail on
// the first poll.
{
  const s = t.step("wait idle --timeout 5s short-circuits to editor_unresponsive");
  const r = runUnictl(["wait", "idle", "--timeout", "5s"]);
  if (r.exitCode !== 3) {
    s.fail(`expected exit 3 (lane unavailable); got ${r.exitCode}: ${r.stdout.slice(0, 200)}`);
    t.finalize();
  }
  const j = parseJsonLine(r.stdout) as { ok?: boolean; error?: { kind?: string } };
  if (j.error?.kind !== "editor_unresponsive") {
    s.fail(`expected kind=editor_unresponsive; got kind=${j.error?.kind}`, j);
    t.finalize();
  }
  s.pass(`exit=3 kind=editor_unresponsive`, j);
}

// Cleanup: restore a healthy editor for subsequent QA tasks. Quit again,
// then relaunch without the override env. We do not gate the cleanup on
// success — best-effort.
process.stderr.write("\n  (cleanup: restoring editor with default reload threshold)\n");
runUnictl(["editor", "quit"]);
await new Promise((r) => setTimeout(r, 3000));
runUnictl(["editor", "open"]);

t.finalize();
