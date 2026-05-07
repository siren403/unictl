#!/usr/bin/env bun
//MISE description="QA: orchestrator — run cycle, sigint, crash, ceiling and aggregate"

import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../../qa-lib.ts";

// Sub-tasks ordered by destructiveness:
//   cycle   — read-only IPC roundtrips, fastest
//   sigint  — in-process synthetic SIGINT, no editor side effects
//   crash   — taskkill + reopen (one editor restart)
//   ceiling — graceful quit + reopen-with-env (two editor restarts)
//
// Skipping the destructive tasks (e.g. when no live editor) is normal — each
// child task already exits 0 with status="skip" in those cases, so the
// orchestrator can treat skip as non-fatal.
const subTasks = ["cycle", "sigint", "crash", "ceiling"];

const startedAtMs = Date.now();
process.stderr.write(`\n=== qa (orchestrator: ${subTasks.length} sub-task(s)) ===\n`);

interface SubResult {
  task: string;
  status: "pass" | "fail" | "skip" | "error";
  elapsed_ms?: number;
  steps?: unknown[];
  error?: string;
}

const results: SubResult[] = [];

for (const name of subTasks) {
  process.stderr.write(`\n--- qa:${name} ---\n`);
  const r = spawnSync("mise", ["run", `qa:${name}`], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: 300_000,
  });
  if (r.error) {
    results.push({ task: `qa:${name}`, status: "error", error: r.error.message });
    continue;
  }
  // Sub-task prints exactly one structured JSON line on stdout (final).
  const lines = (r.stdout ?? "").trim().split(/\r?\n/);
  const last = lines[lines.length - 1] ?? "";
  try {
    const parsed = JSON.parse(last) as SubResult;
    results.push(parsed);
  } catch {
    results.push({ task: `qa:${name}`, status: "error", error: `non-JSON last line: ${last.slice(0, 200)}` });
  }
}

const passed = results.filter((r) => r.status === "pass").length;
const failed = results.filter((r) => r.status === "fail" || r.status === "error").length;
const skipped = results.filter((r) => r.status === "skip").length;
const elapsed_ms = Date.now() - startedAtMs;

const summary = {
  task: "qa",
  status: failed > 0 ? "fail" : skipped === results.length ? "skip" : "pass",
  elapsed_ms,
  totals: { passed, failed, skipped, total: results.length },
  results,
};

process.stdout.write(JSON.stringify(summary) + "\n");

const headline = failed > 0 ? "FAIL" : skipped === results.length ? "SKIP" : "PASS";
process.stderr.write(
  `\n=== qa: ${headline} (${passed} pass / ${failed} fail / ${skipped} skip in ${elapsed_ms}ms) ===\n`,
);
process.exit(failed > 0 ? 1 : 0);
