// Phase C7 of unictl v0.7 — shared --json / UNICTL_HUMAN policy utility.
//
// Per critic 1.5:
//   - New verb-noun commands default `--json` ON.
//   - Legacy v0.6 commands default `--json` OFF (preserves existing UX).
//   - `UNICTL_HUMAN=1` env var forces human-readable output globally.
//   - Explicit `--no-json` flag forces human output (per-invocation override).
//   - Explicit `--json` flag forces JSON output (per-invocation override).
//
// All emit paths in v0.7 should route through `emit()` rather than calling
// `console.log(JSON.stringify(...))` directly so the policy is centralized.

export type CommandKind = "new" | "legacy";

export interface OutputFlags {
  /** Explicit --json. When true, force JSON regardless of kind. */
  json?: boolean;
  /** Explicit --no-json. When true, force human regardless of kind. */
  noJson?: boolean;
}

/**
 * Resolve whether a given (kind, flags) emits JSON.
 *
 * Precedence (highest first):
 *   1. flags.noJson === true  → human
 *   2. flags.json === true    → JSON
 *   3. UNICTL_HUMAN env       → human
 *   4. kind default           → JSON for "new", human for "legacy"
 */
export function shouldEmitJson(kind: CommandKind, flags: OutputFlags = {}): boolean {
  if (flags.noJson === true) return false;
  if (flags.json === true) return true;
  if (process.env.UNICTL_HUMAN === "1") return false;
  return kind === "new";
}

/**
 * Emit data per the policy. JSON outputs compact one-line; human outputs a
 * pretty layout with errors going to stderr.
 */
export function emit(kind: CommandKind, data: unknown, flags: OutputFlags = {}): void {
  if (shouldEmitJson(kind, flags)) {
    console.log(JSON.stringify(data));
  } else {
    formatHuman(data);
  }
}

/**
 * Decide an exit code from a structured payload. Caller can ignore the return
 * value if they manage exit codes themselves.
 */
export function exitCodeFor(payload: { ok?: boolean; error?: { exit_code?: number } }): number {
  if (payload?.ok === false) {
    return payload.error?.exit_code ?? 1;
  }
  return 0;
}

function formatHuman(data: unknown): void {
  if (data === null || data === undefined) {
    console.log("");
    return;
  }
  if (typeof data !== "object") {
    console.log(String(data));
    return;
  }
  const obj = data as Record<string, unknown>;
  if (obj.ok === false && obj.error) {
    const err = obj.error as Record<string, unknown>;
    const kind = err.kind ?? "unknown";
    const message = err.message ?? "";
    console.error(`error: ${kind}: ${message}`);
    if (err.recovery) console.error(`  recovery: ${err.recovery}`);
    if (err.hint_command) console.error(`  try: ${err.hint_command}`);
    return;
  }
  // Fallback: pretty JSON to stdout (still parseable, just multi-line).
  console.log(JSON.stringify(data, null, 2));
}
