export type BuildLifecycleState = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

type JsonRecord = Record<string, unknown>;

const TERMINAL_STATES = new Set<BuildLifecycleState>(["succeeded", "failed", "cancelled"]);

export function normalizeBuildProgress(raw: JsonRecord, fallbackJobId?: string): JsonRecord {
  const rawState = typeof raw.state === "string" ? raw.state : "";
  const state = normalizeBuildState(rawState);
  const terminal = TERMINAL_STATES.has(state);
  const startedAt = typeof raw.started_at === "string" ? raw.started_at : undefined;
  const finishedAt = typeof raw.finished_at === "string" ? raw.finished_at : undefined;

  const normalized: JsonRecord = {
    ...raw,
    job_id: typeof raw.job_id === "string" ? raw.job_id : fallbackJobId,
    raw_state: rawState || undefined,
    state,
    terminal,
    terminal_states: ["succeeded", "failed", "cancelled"],
    result_source: inferResultSource(state, raw),
    result_confidence: inferResultConfidence(state, raw),
    elapsed_ms: computeElapsedMs(startedAt, finishedAt, terminal),
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    suspicion_reasons: Array.isArray(raw.suspicion_reasons) ? raw.suspicion_reasons : [],
    suspicious: raw.suspicious === true,
    recommended_action: raw.recommended_action ?? null,
  };

  if (!normalized.job_id) delete normalized.job_id;
  if (!normalized.raw_state) delete normalized.raw_state;
  if (normalized.elapsed_ms === null) delete normalized.elapsed_ms;

  return normalized;
}

export function normalizeBuildState(rawState: string): BuildLifecycleState {
  switch (rawState.toLowerCase()) {
    case "queued":
      return "queued";
    case "running":
    case "started":
      return "running";
    case "done":
    case "succeeded":
    case "success":
      return "succeeded";
    case "failed":
    case "failure":
      return "failed";
    case "aborted":
    case "cancelled":
    case "canceled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function inferResultSource(state: BuildLifecycleState, raw: JsonRecord): string | null {
  if (typeof raw.result_source === "string") return raw.result_source;
  if (state === "succeeded" && raw.report_summary) return "unity_build_report";
  if (state === "failed" && raw.error) return "unity_build_report";
  if (state === "cancelled") return "build_cancel";
  if (state === "failed") return "progress_file";
  return null;
}

function inferResultConfidence(state: BuildLifecycleState, raw: JsonRecord): string | null {
  if (typeof raw.result_confidence === "string") return raw.result_confidence;
  if (state === "succeeded" && raw.report_summary) return "high";
  if (state === "failed" || state === "cancelled") return "high";
  return null;
}

function computeElapsedMs(startedAt?: string, finishedAt?: string, terminal?: boolean): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  const end = finishedAt ? Date.parse(finishedAt) : terminal ? NaN : Date.now();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, end - start);
}
