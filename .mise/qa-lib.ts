// QA helper library — imported by tasks under .mise/tasks/qa/.
//
// Located outside .mise/tasks/ so mise does not auto-register it as a task.
// Each task file (cycle.ts, sigint.ts, crash.ts, ceiling.ts, _default.ts)
// pulls helpers from here.
//
// Contract:
//   - All assertions are dogfood: route through unictl, parse JSON output,
//     compare against expected envelope shape.
//   - Tasks output one structured JSON line on stdout (CI-parseable) and a
//     human-readable banner on stderr.
//   - Exit code: 0 = pass, 1 = fail, 78 = skipped (precondition not met).

import { spawnSync } from "node:child_process";

export const REPO_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/(\w):\//, "$1:/").replace(/\/$/, "");
export const PROJECT_ROOT = "D:/workspace/unity/PickUpCat";

export interface UnictlResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Invoke `unictl` (the local Bun-driven CLI source) and capture stdio.
 * Always uses the workspace's TS source, never a globally-installed CLI,
 * so QA exercises the exact code under test.
 */
export function runUnictl(args: string[], opts: { project?: string; env?: Record<string, string> } = {}): UnictlResult {
  const project = opts.project ?? PROJECT_ROOT;
  const fullArgs = [...args];
  if (!fullArgs.includes("--project")) {
    fullArgs.push("--project", project);
  }
  const result = spawnSync("bun", ["run", "packages/cli/src/cli.ts", ...fullArgs], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    env: { ...process.env, ...(opts.env ?? {}) },
    timeout: 180_000,
  });
  return {
    exitCode: result.status ?? -1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

/**
 * Parse the first JSON line of stdout. Throws a descriptive error if the
 * line isn't valid JSON — surfaces protocol drift early.
 */
export function parseJsonLine(out: string): unknown {
  const firstLine = out.split(/\r?\n/)[0];
  try {
    return JSON.parse(firstLine);
  } catch (err) {
    throw new Error(`expected JSON on stdout first line; got: ${firstLine.slice(0, 120)}…`);
  }
}

export type StepStatus = "pass" | "fail" | "skip";

export interface StepResult {
  name: string;
  status: StepStatus;
  detail?: string;
  data?: unknown;
}

export class TaskRunner {
  readonly name: string;
  private steps: StepResult[] = [];
  private startedAtMs = Date.now();

  constructor(name: string) {
    this.name = name;
    process.stderr.write(`\n=== ${name} ===\n`);
  }

  step(name: string): StepBuilder {
    return new StepBuilder(name, (result) => {
      this.steps.push(result);
      const icon = result.status === "pass" ? "✔" : result.status === "fail" ? "✖" : "○";
      process.stderr.write(`  ${icon} ${name}${result.detail ? `  — ${result.detail}` : ""}\n`);
    });
  }

  finalize(): never {
    const failed = this.steps.filter((s) => s.status === "fail");
    const skipped = this.steps.filter((s) => s.status === "skip");
    const elapsed_ms = Date.now() - this.startedAtMs;
    const overall: StepStatus = failed.length > 0 ? "fail" : skipped.length === this.steps.length && this.steps.length > 0 ? "skip" : "pass";

    const summary = {
      task: this.name,
      status: overall,
      elapsed_ms,
      steps: this.steps,
    };
    process.stdout.write(JSON.stringify(summary) + "\n");

    process.stderr.write(`\n${overall === "pass" ? "PASS" : overall === "skip" ? "SKIP" : "FAIL"}: ${this.name} (${elapsed_ms}ms, ${this.steps.length} step(s))\n`);

    // mise treats any non-zero exit as task failure. We map skip → exit 0
    // so a precondition miss (no editor) does not turn into a CI red flag,
    // while still surfacing skip status via JSON for downstream parsers.
    process.exit(overall === "fail" ? 1 : 0);
  }
}

export class StepBuilder {
  private result: StepResult;
  private commit: (r: StepResult) => void;

  constructor(name: string, commit: (r: StepResult) => void) {
    this.result = { name, status: "pass" };
    this.commit = commit;
  }

  pass(detail?: string, data?: unknown): void {
    this.result = { ...this.result, status: "pass", detail, data };
    this.commit(this.result);
  }

  fail(detail: string, data?: unknown): void {
    this.result = { ...this.result, status: "fail", detail, data };
    this.commit(this.result);
  }

  skip(detail: string): void {
    this.result = { ...this.result, status: "skip", detail };
    this.commit(this.result);
  }
}

/**
 * Confirm the editor is reachable before running tests that require live IPC.
 *
 * Uses `unictl health` (single fast IPC round-trip) instead of `wait
 * reachable` because the latter blocks on phase_override !== "unresponsive"
 * — fine for production wait UX, too strict for QA precondition: a long
 * compile/import in the editor would falsely fail the precondition even
 * though IPC itself is up. /health responds as long as the IPC handler is
 * registered, regardless of phase.
 */
export function isEditorReachable(): boolean {
  const r = runUnictl(["health"]);
  if (r.exitCode !== 0) return false;
  try {
    const j = parseJsonLine(r.stdout) as { status?: string; handler_registered?: boolean };
    return j.status === "ok" && j.handler_registered === true;
  } catch {
    return false;
  }
}
