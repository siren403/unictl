import { command as ipcCommand } from "./client";
import { errorEnvelope } from "./error";

type ErrorPayload = {
  ok?: boolean;
  error?: {
    kind?: string;
    message?: string;
    exit_code?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type EditorLogItem = {
  line_number?: number;
  text?: string;
};

type CompileErrorDiagnostic = {
  editor_api_reliable: false;
  probable_cause: "unity_compile_errors";
  recommended_command: "unictl command editor_log -p action=errors";
  next_action: "fix_compile_errors_before_retrying_unictl_workflow";
  compile_errors: EditorLogItem[];
  exceptions: EditorLogItem[];
  editor_log: Record<string, unknown>;
};

const COMPILE_ERROR_RE = /\berror\s+CS\d{4}\b/i;
const COMPILE_SUCCESS_RE = /(\*\*\* Tundra build success|Reloading assemblies after finishing script compilation)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export async function detectCompileErrorState(opts?: { project?: string; lines?: number }): Promise<CompileErrorDiagnostic | null> {
  let response: unknown;
  try {
    response = await ipcCommand(
      "editor_log",
      { action: "tail", lines: opts?.lines ?? 400 },
      { project: opts?.project },
    );
  } catch {
    return null;
  }

  const record = asRecord(response);
  if (!record || record.success !== true) return null;

  const data = asRecord(record.data);
  if (!data) return null;

  const tailLines = Array.isArray(data.lines) ? data.lines.map((line) => String(line)) : [];
  const lastSuccessfulCompile = tailLines.reduce(
    (last, line, index) => COMPILE_SUCCESS_RE.test(line) ? index : last,
    -1,
  );
  const diagnosticLines = lastSuccessfulCompile >= 0
    ? tailLines.slice(lastSuccessfulCompile + 1)
    : tailLines;
  const lineOffset = lastSuccessfulCompile + 1;
  const compileErrors = diagnosticLines
    .map((line, index) => ({ line_number: index + 1, text: line }))
    .filter((item) => COMPILE_ERROR_RE.test(item.text))
    .map((item) => ({ ...item, line_number: item.line_number + lineOffset }))
    .slice(-20);
  if (compileErrors.length === 0) return null;

  return {
    editor_api_reliable: false,
    probable_cause: "unity_compile_errors",
    recommended_command: "unictl command editor_log -p action=errors",
    next_action: "fix_compile_errors_before_retrying_unictl_workflow",
    compile_errors: compileErrors,
    exceptions: [],
    editor_log: {
      source: data.source,
      log_path: data.log_path,
      log_is_current_session: data.log_is_current_session,
      requires_editor_restart: data.requires_editor_restart,
      scanned_tail_lines: tailLines.length,
      scanned_after_last_successful_compile: lastSuccessfulCompile >= 0,
      total_count: compileErrors.length,
    },
  };
}

export async function enrichWithCompileErrorState<T extends ErrorPayload>(
  payload: T,
  opts: {
    project?: string;
    workflow: string;
    related?: readonly string[];
  },
): Promise<T> {
  if (payload?.ok !== false) return payload;

  const diagnostic = await detectCompileErrorState({ project: opts.project });
  if (!diagnostic) return payload;

  const originalError = payload.error ?? {};
  const env = errorEnvelope({
    kind: "editor_compile_error_state",
    message: `${opts.workflow} failed while Unity has C# compile errors. Fix compile errors before retrying editor-side unictl workflows.`,
    recovery: "Inspect compile_errors, fix the C# errors in the Unity project, then retry the original unictl command.",
    related: opts.related ?? ["editor.status", "command"],
    context: {
      workflow: opts.workflow,
      original_error: originalError,
      ...diagnostic,
    },
  });

  return {
    ...payload,
    error: {
      ...env.error,
      exit_code: 1,
    },
  };
}

export async function failIfCompileErrorState(
  opts: {
    project?: string;
    workflow: string;
    related?: readonly string[];
    context?: Record<string, unknown>;
  },
): Promise<ErrorPayload | null> {
  const diagnostic = await detectCompileErrorState({ project: opts.project });
  if (!diagnostic) return null;

  const env = errorEnvelope({
    kind: "editor_compile_error_state",
    message: `${opts.workflow} reached its editor state, but Unity has C# compile errors. Fix compile errors before treating editor-side workflows as healthy.`,
    recovery: "Inspect compile_errors, fix the C# errors in the Unity project, then retry the original unictl command.",
    related: opts.related ?? ["editor.status", "command"],
    context: {
      workflow: opts.workflow,
      ...(opts.context ?? {}),
      ...diagnostic,
    },
  });

  return {
    ok: false,
    error: {
      ...env.error,
      exit_code: 1,
    },
  };
}
