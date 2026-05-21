import { existsSync, readFileSync, statSync } from "fs";
import { getProjectEditorLogFiles } from "./log-paths";
import { getProjectPaths } from "./socket";
import { errorEnvelope } from "./error";

type JsonRecord = Record<string, unknown>;

const VALID_ACTIONS = ["tail", "search", "errors"] as const;
const COMPILE_ERROR_RE = /\berror\s+CS\d{4}\b/i;
const EXCEPTION_RE = /^\S*Exception:/;

type LogEntry = {
  line_number: number;
  log_position: number;
  text: string;
};

function stringParam(params: JsonRecord | undefined, key: string): string | undefined {
  const value = params?.[key];
  return typeof value === "string" ? value : undefined;
}

function intParam(params: JsonRecord | undefined, key: string, fallback: number): number {
  const value = stringParam(params, key);
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function asOriginalError(error: unknown): JsonRecord {
  return {
    message: error instanceof Error ? error.message : String(error),
  };
}

function readCompileLifecycle(path: string): JsonRecord | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8").replace(/^\uFEFF/, "")) as JsonRecord;
  } catch {
    return undefined;
  }
}

function numberField(record: JsonRecord | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readLogEntries(path: string): LogEntry[] {
  const bytes = readFileSync(path);
  const entries: LogEntry[] = [];
  let lineStart = 0;
  let lineNumber = 1;

  const decode = (start: number, end: number, firstLine: boolean) => {
    const text = bytes.subarray(start, end).toString("utf-8");
    return firstLine ? text.replace(/^\uFEFF/, "") : text;
  };

  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0x0a) continue;
    const lineEnd = i > lineStart && bytes[i - 1] === 0x0d ? i - 1 : i;
    entries.push({
      line_number: lineNumber,
      log_position: lineStart,
      text: decode(lineStart, lineEnd, lineNumber === 1),
    });
    lineStart = i + 1;
    lineNumber++;
  }

  if (lineStart < bytes.length) {
    entries.push({
      line_number: lineNumber,
      log_position: lineStart,
      text: decode(lineStart, bytes.length, lineNumber === 1),
    });
  }

  return entries;
}

function baseData(args: {
  projectRoot: string;
  logPath: string;
  lines: string[];
  originalError: unknown;
}): JsonRecord {
  const stat = statSync(args.logPath);
  return {
    source: "project",
    fallback_used: true,
    fallback_kind: "cli_project_log_file",
    warning: "IPC command editor_log failed, so the CLI read Library/unictl-state/editor-current.log directly.",
    log_path: args.logPath,
    project_log_path: args.logPath,
    log_exists: true,
    project_log_exists: true,
    log_last_write_at: stat.mtime.toISOString(),
    requires_editor_restart: false,
    recommended_command: null,
    ipc_error: asOriginalError(args.originalError),
    project_root: args.projectRoot,
    total_lines: args.lines.length,
  };
}

function unavailable(args: {
  action: string | undefined;
  projectRoot: string;
  logPath: string;
  originalError: unknown;
}): JsonRecord {
  return errorEnvelope({
    kind: "editor_log_unavailable",
    message: "editor_log IPC failed and the project-scoped editor log file is unavailable.",
    recovery: "Start or restart the editor through unictl so Unity writes Library/unictl-state/editor-current.log, then retry editor_log.",
    related: ["command", "editor.open", "doctor"],
    context: {
      tool: "editor_log",
      action: args.action ?? null,
      fallback_kind: "cli_project_log_file",
      project_root: args.projectRoot,
      log_path: args.logPath,
      log_exists: false,
      requires_editor_restart: true,
      recommended_command: `unictl editor restart --project ${args.projectRoot}`,
      ipc_error: asOriginalError(args.originalError),
    },
  });
}

function invalidParam(message: string, params: JsonRecord | undefined): JsonRecord {
  return errorEnvelope({
    kind: "invalid_param",
    message,
    recovery: "Use: unictl command editor_log -p action=tail|search|errors.",
    related: ["command"],
    context: {
      tool: "editor_log",
      params: params ?? null,
      valid_actions: [...VALID_ACTIONS],
    },
  });
}

export function runEditorLogFileFallback(args: {
  params?: JsonRecord;
  project?: string;
  originalError: unknown;
}): JsonRecord {
  const action = stringParam(args.params, "action");
  if (!action) {
    return invalidParam("Missing required editor_log param: action.", args.params);
  }
  if (!VALID_ACTIONS.includes(action as typeof VALID_ACTIONS[number])) {
    return invalidParam(`Unknown editor_log action '${action}'. Valid actions: ${VALID_ACTIONS.join(", ")}.`, args.params);
  }

  const { projectRoot } = getProjectPaths(args.project);
  const logFiles = getProjectEditorLogFiles(projectRoot);
  const logPath = logFiles.editor_log_file;
  if (!existsSync(logPath)) {
    return unavailable({
      action,
      projectRoot,
      logPath,
      originalError: args.originalError,
    });
  }

  const entries = readLogEntries(logPath);
  const lineLimit = intParam(args.params, "lines", action === "tail" ? 50 : 100);
  const lines = entries.map((entry) => entry.text);
  const common = baseData({
    projectRoot,
    logPath,
    lines,
    originalError: args.originalError,
  });

  if (action === "tail") {
    const result = lines.slice(Math.max(0, lines.length - lineLimit));
    return {
      success: true,
      message: "Editor log tail (CLI file fallback after IPC failure)",
      data: {
        ...common,
        includes_compile_errors: true,
        returned_lines: result.length,
        lines: result,
      },
    };
  }

  if (action === "search") {
    const pattern = stringParam(args.params, "pattern");
    if (!pattern) {
      return invalidParam("Missing required editor_log param for action=search: pattern.", args.params);
    }
    const matches = lines
      .map((line, index) => ({ line_number: index + 1, text: line }))
      .filter((entry) => entry.text.toLowerCase().includes(pattern.toLowerCase()))
      .slice(-lineLimit);
    return {
      success: true,
      message: `Found ${matches.length} matches for '${pattern}' (CLI file fallback after IPC failure)`,
      data: {
        ...common,
        includes_compile_errors: true,
        match_mode: "literal_substring",
        pattern,
        matches,
      },
    };
  }

  const lifecycle = readCompileLifecycle(logFiles.compile_lifecycle_file);
  const boundary = numberField(lifecycle, "started_log_position");
  const logSize = statSync(logPath).size;
  const hasBoundary = boundary !== undefined && boundary >= 0 && boundary <= logSize;
  let staleCompileErrors = 0;
  let staleExceptions = 0;
  const compileErrors: LogEntry[] = [];
  const exceptions: LogEntry[] = [];

  for (const entry of entries) {
    const stale = hasBoundary && entry.log_position < boundary;
    if (COMPILE_ERROR_RE.test(entry.text)) {
      if (stale) staleCompileErrors++;
      else compileErrors.push(entry);
    } else if (EXCEPTION_RE.test(entry.text)) {
      if (stale) staleExceptions++;
      else exceptions.push(entry);
    }
  }

  const compileErrorsTrimmed = compileErrors.slice(-lineLimit);
  const exceptionsTrimmed = exceptions.slice(-lineLimit);
  const staleTotal = staleCompileErrors + staleExceptions;
  const total = compileErrors.length + exceptions.length;

  return {
    success: true,
    message: total === 0
      ? staleTotal > 0
        ? `No current compile errors or exceptions found; omitted ${staleTotal} stale pre-compile-boundary entries (CLI file fallback after IPC failure)`
        : "No compile errors or exceptions found (CLI file fallback after IPC failure)"
      : `Found ${compileErrorsTrimmed.length} current compile errors, ${exceptionsTrimmed.length} current exceptions (CLI file fallback after IPC failure)`,
    data: {
      ...common,
      compile_errors: compileErrorsTrimmed,
      exceptions: exceptionsTrimmed,
      total_count: compileErrorsTrimmed.length + exceptionsTrimmed.length,
      freshness: {
        filter_mode: hasBoundary ? "latest_compile_started_log_position" : "entire_current_session_no_compile_boundary",
        stale_possible: !hasBoundary,
        log_position_boundary: hasBoundary ? boundary : null,
        stale_compile_errors_omitted: staleCompileErrors,
        stale_exceptions_omitted: staleExceptions,
        stale_total_omitted: staleTotal,
        compile_lifecycle: lifecycle ?? null,
      },
    },
  };
}
