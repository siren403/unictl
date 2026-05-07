#!/usr/bin/env bun
//MISE description="QA: SIGINT during runWait — expect kind:interrupted exit 130"

import { TaskRunner } from "../../qa-lib.ts";

const t = new TaskRunner("qa:sigint");

// This task exercises the runWait engine in-process so we can deterministically
// inject SIGINT mid-wait (instead of trying to send a real OS signal to a
// child process, which is platform-flaky on Windows). The wait engine listens
// via process.once("SIGINT", ...); we trigger that listener with
// process.emit("SIGINT") after a short delay.

const { runWait } = await import("../../../packages/cli/src/wait.ts");

// Schedule a synthetic SIGINT 800ms in.
const triggeredAt = Date.now();
const sigintDelayMs = 800;
setTimeout(() => process.emit("SIGINT"), sigintDelayMs);

// Wait against a non-existent project so the loop spins forever (no
// runtime.json, no IPC reachable). target=reachable bypasses the
// editor_unresponsive short-circuit (which only fires for non-reachable
// targets), so SIGINT is the only exit path and we get a clean signal-only
// test that does not depend on whether a live editor is healthy.
const s = t.step("runWait('reachable', timeout=0, no-project) interrupted by SIGINT");
const outcome = await runWait({
  state: "reachable",
  timeoutSeconds: 0,
  project: "Z:/qa/no-such-project",
});
const elapsedSinceTrigger = Date.now() - triggeredAt;

if (outcome.kind !== "interrupted") {
  s.fail(`expected kind=interrupted; got kind=${outcome.kind} after ${elapsedSinceTrigger}ms`, outcome);
  t.finalize();
}
if (outcome.elapsed_ms < sigintDelayMs) {
  s.fail(`elapsed_ms=${outcome.elapsed_ms} < trigger delay ${sigintDelayMs}ms — SIGINT fired too early?`, outcome);
  t.finalize();
}
// Hard upper bound: the engine polls every 250ms, so it should pick up the
// SIGINT within one poll cycle of the trigger plus modest scheduling jitter.
const ceiling = sigintDelayMs + 1500;
if (outcome.elapsed_ms > ceiling) {
  s.fail(`elapsed_ms=${outcome.elapsed_ms} > ceiling ${ceiling}ms — SIGINT was slow to take effect`, outcome);
  t.finalize();
}
s.pass(`elapsed_ms=${outcome.elapsed_ms}, target=reachable`, outcome);

t.finalize();
