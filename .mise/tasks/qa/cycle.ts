#!/usr/bin/env bun
//MISE description="QA: editor compile/play/stop wait cycle on a live editor"
//MISE alias="qa:cycle"

import { TaskRunner, runUnictl, parseJsonLine, isEditorReachable } from "../../qa-lib.ts";

const t = new TaskRunner("qa:cycle");

const reach = t.step("editor reachable");
if (!isEditorReachable()) {
  reach.skip("editor not reachable; start it with `unictl editor open` before running this task");
  t.finalize();
}
reach.pass();

// Step 1: editor compile + wait idle (covers reload re-arm if a reload fires)
{
  const s = t.step("editor compile --wait idle");
  const r = runUnictl(["editor", "compile", "--wait", "idle", "--timeout", "90s"]);
  if (r.exitCode !== 0) { s.fail(`exit ${r.exitCode}`, { stderr: r.stderr.slice(0, 200) }); t.finalize(); }
  const j = parseJsonLine(r.stdout) as { ok: boolean; wait?: { phase: string; elapsed_ms: number } };
  if (!j.ok || j.wait?.phase !== "idle") { s.fail(`expected ok && phase=idle; got ${JSON.stringify(j).slice(0, 200)}`); t.finalize(); }
  s.pass(`elapsed_ms=${j.wait?.elapsed_ms}`, j.wait);
}

// Step 2: editor play + wait playing (60s budget covers asset-heavy projects
// that take longer than F.3's 15s default to enter Play mode).
{
  const s = t.step("editor play --wait playing");
  const r = runUnictl(["editor", "play", "--wait", "playing", "--timeout", "60s"]);
  if (r.exitCode !== 0) { s.fail(`exit ${r.exitCode}`, { stderr: r.stderr.slice(0, 200), stdout: r.stdout.slice(0, 200) }); t.finalize(); }
  const j = parseJsonLine(r.stdout) as { ok: boolean; wait?: { phase: string; elapsed_ms: number } };
  if (!j.ok || j.wait?.phase !== "playing") { s.fail(`expected ok && phase=playing; got ${JSON.stringify(j).slice(0, 200)}`); t.finalize(); }
  s.pass(`elapsed_ms=${j.wait?.elapsed_ms}`, j.wait);
}

// Step 3: editor stop + wait idle (covers play→edit reload window; 60s
// covers slow reloads up to A4 ceiling without flaking).
{
  const s = t.step("editor stop --wait idle");
  const r = runUnictl(["editor", "stop", "--wait", "idle", "--timeout", "60s"]);
  if (r.exitCode !== 0) { s.fail(`exit ${r.exitCode}`, { stderr: r.stderr.slice(0, 200), stdout: r.stdout.slice(0, 200) }); t.finalize(); }
  const j = parseJsonLine(r.stdout) as { ok: boolean; wait?: { phase: string; elapsed_ms: number } };
  if (!j.ok || j.wait?.phase !== "idle") { s.fail(`expected ok && phase=idle; got ${JSON.stringify(j).slice(0, 200)}`); t.finalize(); }
  s.pass(`elapsed_ms=${j.wait?.elapsed_ms}`, j.wait);
}

t.finalize();
