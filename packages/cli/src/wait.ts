// Phase D of unictl v0.7 — `unictl wait <state>` engine.
//
// Sits on top of:
//   - Phase A3 /liveness route + format_liveness_response (lib.rs)
//   - Phase B5 runtime.json reader (runtime.ts)
//   - F.3 timeout default matrix (docs/standalone/v0.7-spikes/F3-wait-timeouts.md)
//   - F.7 Pull cadence 250ms (docs/standalone/v0.7-spikes/F7-push-vs-poll.md)
//
// Contract:
//   - Block until the editor reaches the target state OR timeout fires OR SIGINT.
//   - Reload-aware re-arm (D6 / A4): when phase=reloading the timeout clock pauses
//     while the budget would otherwise be drained.
//   - Exit codes:
//        0   target state reached
//        3   editor not running / unresponsive (lane unavailable)
//        124 wait_timeout
//        125 ipc_error (unexpected internal failure)
//        130 interrupted (SIGINT during wait)
//
// All envelopes are emitted via output.ts so --json / UNICTL_HUMAN policy applies.

import { liveness } from "./client";
import { errorEnvelope } from "./error";
import { getRuntimeStatus } from "./runtime";
import { findProjectRoot } from "./socket";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type WaitState = "idle" | "playing" | "compiling" | "reloading" | "reachable";

export const WAIT_STATES: readonly WaitState[] = [
  "idle",
  "playing",
  "compiling",
  "reloading",
  "reachable",
];

export interface WaitOptions {
  state: WaitState;
  /** Bare seconds. 0 = unbounded. Negative or NaN treated as "use default". */
  timeoutSeconds: number;
  project?: string;
  /** Pull cadence override for tests. */
  pollIntervalMs?: number;
}

export type WaitOutcome =
  | { kind: "reached"; state: WaitState; phase: string; alive_ms_ago: number; elapsed_ms: number }
  | { kind: "wait_timeout"; state: WaitState; observed_phase: string | null; elapsed_ms: number; budget_ms: number }
  | { kind: "editor_not_running"; state: WaitState; elapsed_ms: number }
  | { kind: "editor_unresponsive"; state: WaitState; elapsed_ms: number; alive_ms_ago: number }
  | { kind: "interrupted"; state: WaitState; elapsed_ms: number }
  | { kind: "ipc_error"; state: WaitState; message: string; elapsed_ms: number };

const DEFAULT_POLL_INTERVAL_MS = 250;

// ---------------------------------------------------------------------------
// Duration parsing — F.3 input grammar (`30s`, `2m`, `1h`, `120`, `0`)
// ---------------------------------------------------------------------------

/**
 * Parse a duration string into seconds.
 *   - "30s"  → 30
 *   - "2m"   → 120
 *   - "1h"   → 3600
 *   - "120"  → 120  (bare integer = seconds)
 *   - "0"    → 0    (caller treats as unbounded)
 * Returns NaN on garbage so the caller can fall back to defaults / report error.
 */
export function parseDuration(input: string | undefined): number {
  if (input === undefined || input === null || input === "") return NaN;
  const trimmed = String(input).trim().toLowerCase();
  if (trimmed === "0") return 0;
  const m = trimmed.match(/^(\d+)\s*(s|m|h)?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return NaN;
  switch (m[2]) {
    case "h": return n * 3600;
    case "m": return n * 60;
    case "s":
    case undefined:
    default:
      return n;
  }
}

// ---------------------------------------------------------------------------
// F.3 timeout matrix — verb × state defaults + env override
// ---------------------------------------------------------------------------

/**
 * Compiled defaults from F3-wait-timeouts.md. Keyed by `<verb>.<state>`.
 * `verb` is canonical dot-path (e.g. "editor.compile", "test.editmode"),
 * "any" applies to cross-cutting states.
 */
const COMPILED_DEFAULTS: Record<string, number> = {
  "editor.compile.idle": 120,
  "editor.play.playing": 15,
  "editor.stop.idle": 30,
  "editor.refresh.idle": 90,
  "test.editmode.idle": 300,
  "test.playmode.idle": 300,
  "any.reachable": 120,
  "any.reloading": 30,
  "any.quit": 15,
  // Bare `unictl wait <state>` defaults (no triggering verb): use the (any)
  // timeouts where they exist; otherwise fall through to the conservative
  // 120s reachable default per F.3 considerations.
  "wait.idle": 120,
  "wait.playing": 15,
  "wait.compiling": 120,
  "wait.reloading": 30,
  "wait.reachable": 120,
};

/**
 * Resolve the default timeout (seconds) for a (verb, state) pair, honoring
 * the env override per F.3 precedence rules.
 *
 *   Precedence:
 *     1. flag (handled by caller)
 *     2. UNICTL_WAIT_TIMEOUT_DEFAULT_<VERB>_<STATE>  (this lookup)
 *     3. compiled default
 */
export function lookupTimeoutDefault(verb: string, state: WaitState): number {
  const envName = `UNICTL_WAIT_TIMEOUT_DEFAULT_${verb.toUpperCase().replaceAll(".", "_")}_${state.toUpperCase()}`;
  const envVal = process.env[envName];
  if (envVal !== undefined) {
    const parsed = parseDuration(envVal);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const key = `${verb}.${state}`;
  if (key in COMPILED_DEFAULTS) return COMPILED_DEFAULTS[key];
  // Fall through to "any.<state>" if the verb-specific entry is missing.
  const anyKey = `any.${state}`;
  if (anyKey in COMPILED_DEFAULTS) return COMPILED_DEFAULTS[anyKey];
  return 120; // hard fallback — should never hit for known states
}

// ---------------------------------------------------------------------------
// State predicate — does the /liveness response satisfy the target?
// ---------------------------------------------------------------------------

interface LivenessResponse {
  schema_version: number;
  alive_ms_ago: number;
  last_heartbeat_ms: number;
  last_state: { phase?: string; [k: string]: unknown };
  pid: number;
  handler_registered: boolean;
  phase_override: "never_seen" | "unresponsive" | null;
  native_version: string;
}

interface MatchResult {
  matched: boolean;
  phase: string;
  unresponsive: boolean;
}

/**
 * Compute the effective phase from a /liveness payload, honoring phase_override
 * (never_seen, unresponsive). Returns the raw phase if no override applies.
 */
function effectivePhase(resp: LivenessResponse): { phase: string; unresponsive: boolean } {
  if (resp.phase_override === "unresponsive") return { phase: "unresponsive", unresponsive: true };
  if (resp.phase_override === "never_seen") return { phase: "never_seen", unresponsive: false };
  const raw = (resp.last_state?.phase as string | undefined) ?? "unknown";
  return { phase: raw, unresponsive: false };
}

/**
 * Does the current /liveness response match the requested wait state?
 *
 * Rules (matches Phase A1 ADR + describe metadata):
 *   - reachable: any successful response with handler_registered=true (the
 *     editor is up and the IPC handler is wired). Heartbeat state is not part
 *     of the reachable contract because /health and /command can be usable
 *     before the first heartbeat or while the editor is unfocused.
 *   - idle / playing / compiling / reloading: phase exactly matches.
 *   - playing also accepts "paused" (still in Play mode, just paused).
 */
function matchState(target: WaitState, resp: LivenessResponse): MatchResult {
  const { phase, unresponsive } = effectivePhase(resp);
  if (target === "reachable") {
    const matched = resp.handler_registered === true;
    return { matched, phase, unresponsive };
  }
  if (target === "playing") {
    return { matched: phase === "playing" || phase === "paused", phase, unresponsive };
  }
  return { matched: phase === target, phase, unresponsive };
}

// ---------------------------------------------------------------------------
// Pull loop with reload-aware re-arm (D1 + D6)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run the wait loop. Pure logic — caller is responsible for emitting the
 * outcome envelope and exiting with the appropriate code.
 *
 * Returns when:
 *   - target state reached (kind: "reached")
 *   - budget exhausted (kind: "wait_timeout")
 *   - editor not running / no runtime.json (kind: "editor_not_running")
 *   - editor unresponsive past A4 ceiling (kind: "editor_unresponsive")
 *   - SIGINT received (kind: "interrupted")
 *   - Internal/IPC error (kind: "ipc_error")
 *
 * `timeoutSeconds === 0` means unbounded. Reload-aware re-arm: when we observe
 * phase=reloading the budget clock pauses for the duration of that observation
 * and resumes once we see a different phase. F.3 caps the reload window at 30s
 * (A4 ceiling); the heartbeat goes `unresponsive` if it exceeds that, and we
 * surface `editor_unresponsive` rather than silently consuming budget.
 */
export async function runWait(opts: WaitOptions): Promise<WaitOutcome> {
  const target = opts.state;
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const budgetMs = opts.timeoutSeconds > 0 ? opts.timeoutSeconds * 1000 : 0; // 0 = unbounded
  const startedAt = Date.now();

  // SIGINT handler scoped to this call. Resolves the loop with `interrupted`
  // without leaving a stray listener attached after we return.
  let interrupted = false;
  const onSigint = () => {
    interrupted = true;
  };
  process.once("SIGINT", onSigint);

  // Track time the budget should be paused (sum of all observed reload windows).
  let pausedMs = 0;
  let pauseStart: number | null = null;

  try {
    while (true) {
      if (interrupted) {
        return {
          kind: "interrupted",
          state: target,
          elapsed_ms: Date.now() - startedAt,
        };
      }

      // Step 1 — runtime.json sanity. If the editor isn't running and we're
      // not waiting for `reachable`, fail fast (don't spin while there's no
      // process). For `reachable` we keep polling — the editor may be
      // starting up.
      let projectRoot: string | null = null;
      try {
        projectRoot = findProjectRoot(opts.project) ?? null;
      } catch {
        projectRoot = null;
      }
      if (projectRoot) {
        const runtimeStatus = getRuntimeStatus(projectRoot);
        if (runtimeStatus.status === "not_running" || runtimeStatus.status === "died") {
          if (target !== "reachable") {
            return {
              kind: "editor_not_running",
              state: target,
              elapsed_ms: Date.now() - startedAt,
            };
          }
          // For reachable: editor is not up yet, keep polling within budget.
        }
      }

      // Step 2 — /liveness probe.
      let resp: LivenessResponse | null = null;
      let livenessThrew = false;
      try {
        resp = (await liveness({ project: opts.project })) as LivenessResponse;
      } catch {
        livenessThrew = true;
      }

      if (resp) {
        const { matched, phase, unresponsive } = matchState(target, resp);

        // Reload-aware re-arm: pause the clock while we're in a reload window
        // (unless the user explicitly waits for `reloading`, in which case we
        // want the budget to apply normally).
        if (phase === "reloading" && target !== "reloading") {
          if (pauseStart === null) pauseStart = Date.now();
        } else if (pauseStart !== null) {
          pausedMs += Date.now() - pauseStart;
          pauseStart = null;
        }

        if (matched) {
          return {
            kind: "reached",
            state: target,
            phase,
            alive_ms_ago: resp.alive_ms_ago,
            elapsed_ms: Date.now() - startedAt,
          };
        }

        if (unresponsive && target !== "reachable") {
          return {
            kind: "editor_unresponsive",
            state: target,
            elapsed_ms: Date.now() - startedAt,
            alive_ms_ago: resp.alive_ms_ago,
          };
        }
      }

      // Step 3 — budget check. Account for paused reload windows.
      if (budgetMs > 0) {
        const liveMs = pauseStart === null
          ? Date.now() - startedAt - pausedMs
          : Date.now() - startedAt - pausedMs - (Date.now() - pauseStart);
        if (liveMs >= budgetMs) {
          return {
            kind: "wait_timeout",
            state: target,
            observed_phase: resp ? effectivePhase(resp).phase : null,
            elapsed_ms: Date.now() - startedAt,
            budget_ms: budgetMs,
          };
        }
      }

      if (livenessThrew && target === "reachable") {
        // Connection refused / pipe missing — keep polling for the editor.
      } else if (livenessThrew) {
        // For non-reachable states, repeated connection failures suggest the
        // editor exited. Loop one more time (runtime.json check above will
        // catch a real `not_running` next iteration).
      }

      await sleep(pollMs);
    }
  } finally {
    process.off("SIGINT", onSigint);
  }
}

// ---------------------------------------------------------------------------
// Outcome → envelope adapter (used by v07-commands.ts wait body)
// ---------------------------------------------------------------------------

export interface WaitEnvelope {
  ok: boolean;
  state: WaitState;
  phase?: string;
  alive_ms_ago?: number;
  elapsed_ms: number;
  error?: ReturnType<typeof errorEnvelope>["error"] & { exit_code: number };
}

export function outcomeToEnvelope(outcome: WaitOutcome): WaitEnvelope {
  switch (outcome.kind) {
    case "reached":
      return {
        ok: true,
        state: outcome.state,
        phase: outcome.phase,
        alive_ms_ago: outcome.alive_ms_ago,
        elapsed_ms: outcome.elapsed_ms,
      };
    case "wait_timeout": {
      const env = errorEnvelope({
        kind: "wait_timeout",
        message: `Timed out after ${outcome.budget_ms}ms waiting for state '${outcome.state}'.`,
        recovery: `Verify editor health with 'unictl health' or raise --timeout. Last observed phase: ${outcome.observed_phase ?? "unknown"}.`,
        related: ["editor.status", "wait"],
        context: {
          target_state: outcome.state,
          observed_phase: outcome.observed_phase,
          budget_ms: outcome.budget_ms,
        },
      });
      return {
        ok: false,
        state: outcome.state,
        elapsed_ms: outcome.elapsed_ms,
        error: { ...env.error, exit_code: 124 },
      };
    }
    case "editor_not_running": {
      const env = errorEnvelope({
        kind: "editor_not_running",
        message: `Editor is not running; cannot wait for state '${outcome.state}'.`,
        recovery: "Start the editor with 'unictl editor open', or wait for 'reachable' instead.",
        related: ["editor.open", "wait"],
        context: { target_state: outcome.state },
      });
      return {
        ok: false,
        state: outcome.state,
        elapsed_ms: outcome.elapsed_ms,
        error: { ...env.error, exit_code: 3 },
      };
    }
    case "editor_unresponsive": {
      const env = errorEnvelope({
        kind: "editor_unresponsive",
        message: `Editor heartbeat is stale (alive_ms_ago=${outcome.alive_ms_ago}ms exceeds reload ceiling).`,
        recovery: "Check editor logs; the process may be hung in a long compile or domain reload. Consider 'unictl editor restart'.",
        related: ["editor.restart", "editor.status"],
        context: {
          target_state: outcome.state,
          alive_ms_ago: outcome.alive_ms_ago,
        },
      });
      return {
        ok: false,
        state: outcome.state,
        elapsed_ms: outcome.elapsed_ms,
        error: { ...env.error, exit_code: 3 },
      };
    }
    case "interrupted": {
      const env = errorEnvelope({
        kind: "interrupted",
        message: "Wait was interrupted by SIGINT before the target state was reached.",
        recovery: "Re-run the command if the cancellation was unintentional.",
        related: ["wait"],
        context: { target_state: outcome.state },
      });
      return {
        ok: false,
        state: outcome.state,
        elapsed_ms: outcome.elapsed_ms,
        error: { ...env.error, exit_code: 130 },
      };
    }
    case "ipc_error": {
      const env = errorEnvelope({
        kind: "ipc_error",
        message: outcome.message,
        recovery: "Run 'unictl doctor' for a diagnostic snapshot.",
        related: ["doctor", "health"],
        context: { target_state: outcome.state },
      });
      return {
        ok: false,
        state: outcome.state,
        elapsed_ms: outcome.elapsed_ms,
        error: { ...env.error, exit_code: 125 },
      };
    }
  }
}
