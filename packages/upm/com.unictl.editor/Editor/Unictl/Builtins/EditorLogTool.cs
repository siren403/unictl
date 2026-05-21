using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Unictl.Tools
{
    [UnictlTool(Name = "editor_log", Description = "Read Unity editor logs from the project-scoped editor log when available. Use tail/search/errors; game_logs is deprecated.")]
    public static class EditorLogTool
    {
        private static readonly string[] ValidActions = { "tail", "search", "errors", "game_logs", "clear_game_logs" };
        private static readonly string[] CommonParams = { "action", "lines" };
        private static readonly string[] SearchParams = { "pattern" };
        private static readonly Regex CompileErrorRegex = new Regex(@"\berror\s+CS\d{4}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex ExceptionRegex = new Regex(@"^\S*Exception:", RegexOptions.Compiled);

        public class Parameters
        {
            [ToolParameter("Action: tail, search, errors, game_logs, clear_game_logs. game_logs and clear_game_logs are deprecated; use tail/search/errors.", Required = true, Enum = "tail,search,errors,game_logs,clear_game_logs")]
            public string Action { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var (ok, action, err) = p.GetRequired("action");
            if (!ok) return MissingAction(parameters, err);

            switch (action)
            {
                case "tail": return DoTail(parameters, p);
                case "search": return DoSearch(parameters, p);
                case "errors": return DoErrors(parameters, p);
                case "game_logs":
                case "clear_game_logs":
                    return DeprecatedGameLogsResponse(action);
                default:
                    return UnknownAction(parameters, action);
            }
        }

        private static object DoTail(JObject parameters, ToolParams p)
        {
            var unknown = UnknownParams(parameters, CommonParams);
            if (unknown.Length > 0)
                return UnknownParamsResponse("tail", unknown, CommonParams);

            var lines = p.GetInt("lines", 50).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            var readiness = ValidateLogSource(logSource);
            if (!readiness.Usable)
                return readiness.ToErrorResponse();

            var allLines = ReadLogEntriesShared(logPath);
            var start = Math.Max(0, allLines.Count - lines);
            var result = allLines.Skip(start).Select(entry => entry.Text).ToArray();

            return new SuccessResponse("Editor log tail (file-based, includes compile errors)", readiness.With(new
            {
                source = logSource.Source,
                fallback_used = logSource.FallbackUsed,
                includes_compile_errors = true,
                log_path = logPath,
                total_lines = allLines.Count,
                returned_lines = result.Length,
                lines = result
            }));
        }

        private static object DoSearch(JObject parameters, ToolParams p)
        {
            var validParams = CommonParams.Concat(SearchParams).ToArray();
            var unknown = UnknownParams(parameters, validParams);
            if (unknown.Length > 0)
                return UnknownParamsResponse("search", unknown, validParams);

            var (ok, pattern, err) = p.GetRequired("pattern");
            if (!ok) return new ErrorResponse($"{err}; valid params: {string.Join(", ", validParams)}", new
            {
                action = "search",
                missing = new[] { "pattern" },
                unknown,
                valid_params = validParams,
                valid_actions = ValidActions
            });

            var lines = p.GetInt("lines", 100).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            var readiness = ValidateLogSource(logSource);
            if (!readiness.Usable)
                return readiness.ToErrorResponse();

            var matches = ReadLogEntriesShared(logPath)
                .Where(entry => entry.Text.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0)
                .TakeLast(lines)
                .Select(entry => new { line_number = entry.LineNumber, log_position = entry.Offset, text = entry.Text })
                .ToArray();

            return new SuccessResponse($"Found {matches.Length} matches for '{pattern}' (file-based)", readiness.With(new
            {
                source = logSource.Source,
                fallback_used = logSource.FallbackUsed,
                includes_compile_errors = true,
                log_path = logPath,
                match_mode = "literal_substring",
                pattern,
                matches
            }));
        }

        private static object DoErrors(JObject parameters, ToolParams p)
        {
            var unknown = UnknownParams(parameters, CommonParams);
            if (unknown.Length > 0)
                return UnknownParamsResponse("errors", unknown, CommonParams);

            var lines = p.GetInt("lines", 100).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            var readiness = ValidateLogSource(logSource);
            if (!readiness.Usable)
                return readiness.ToErrorResponse();

            var allLines = ReadLogEntriesShared(logPath);
            var lifecycle = UnictlHeartbeat.CompileLifecycleSnapshot();
            var boundary = lifecycle["started_log_position"]?.Type == JTokenType.Integer
                ? lifecycle["started_log_position"]?.ToObject<long>()
                : null;
            var hasBoundary = boundary.HasValue && boundary.Value >= 0 && boundary.Value <= new FileInfo(logPath).Length;
            var compileErrors = new List<object>();
            var exceptions = new List<object>();
            var staleCompileErrors = 0;
            var staleExceptions = 0;

            foreach (var entry in allLines)
            {
                var stale = hasBoundary && entry.Offset < boundary.Value;
                if (CompileErrorRegex.IsMatch(entry.Text))
                {
                    if (stale) staleCompileErrors++;
                    else compileErrors.Add(new { line_number = entry.LineNumber, log_position = entry.Offset, text = entry.Text });
                }
                else if (ExceptionRegex.IsMatch(entry.Text))
                {
                    if (stale) staleExceptions++;
                    else exceptions.Add(new { line_number = entry.LineNumber, log_position = entry.Offset, text = entry.Text });
                }
            }

            var compileTrimmed = compileErrors.TakeLast(lines).ToArray();
            var exceptionsTrimmed = exceptions.TakeLast(lines).ToArray();
            var total = compileTrimmed.Length + exceptionsTrimmed.Length;
            var omitted = staleCompileErrors + staleExceptions;
            var freshness = new
            {
                filter_mode = hasBoundary ? "latest_compile_started_log_position" : "entire_current_session_no_compile_boundary",
                stale_possible = !hasBoundary,
                log_position_boundary = hasBoundary ? boundary : null,
                stale_compile_errors_omitted = staleCompileErrors,
                stale_exceptions_omitted = staleExceptions,
                stale_total_omitted = omitted,
                compile_lifecycle = lifecycle
            };

            return new SuccessResponse(
                total == 0
                    ? (omitted > 0
                        ? $"No current compile errors or exceptions found; omitted {omitted} stale pre-compile-boundary entries"
                        : "No compile errors or exceptions found")
                    : $"Found {compileTrimmed.Length} current compile errors, {exceptionsTrimmed.Length} current exceptions",
                readiness.With(new
                {
                    source = logSource.Source,
                    fallback_used = logSource.FallbackUsed,
                    log_path = logPath,
                    compile_errors = compileTrimmed,
                    exceptions = exceptionsTrimmed,
                    total_count = total,
                    freshness
                }));
        }

        private static object DeprecatedGameLogsResponse(string action)
        {
            return new ErrorResponse("game_logs is deprecated; use editor_log tail/search/errors instead", new
            {
                deprecated = true,
                action,
                kind = "deprecated_log_source",
                message = "game_logs used an in-memory Application.logMessageReceived buffer and is not reliable across domain reloads or editor restarts.",
                replacement = "editor_log",
                replacement_actions = new[] { "tail", "search", "errors" }
            });
        }

        private static ErrorResponse MissingAction(JObject parameters, string message)
        {
            var validParams = CommonParams.Concat(SearchParams).ToArray();
            var unknown = UnknownParams(parameters, validParams);
            var suffix = unknown.Length > 0
                ? $"; unknown params: {string.Join(", ", unknown)}"
                : "";
            return new ErrorResponse($"{message}{suffix}", new
            {
                missing = new[] { "action" },
                unknown,
                valid_params = validParams,
                valid_actions = ValidActions
            });
        }

        private static ErrorResponse UnknownAction(JObject parameters, string action)
        {
            var validParams = CommonParams.Concat(SearchParams).ToArray();
            var unknown = UnknownParams(parameters, validParams);
            return new ErrorResponse($"Unknown action: {action}. Valid actions: {string.Join(", ", ValidActions)}", new
            {
                action,
                unknown,
                valid_params = validParams,
                valid_actions = ValidActions
            });
        }

        private static ErrorResponse UnknownParamsResponse(string action, string[] unknown, string[] validParams)
        {
            return new ErrorResponse($"Unknown editor_log params for action={action}: {string.Join(", ", unknown)}", new
            {
                action,
                unknown,
                valid_params = validParams,
                valid_actions = ValidActions
            });
        }

        private static string[] UnknownParams(JObject parameters, IEnumerable<string> validParams)
        {
            if (parameters == null)
                return Array.Empty<string>();

            var valid = new HashSet<string>(validParams, StringComparer.OrdinalIgnoreCase);
            valid.Add("_meta");
            return parameters.Properties()
                .Select(prop => prop.Name)
                .Where(name => !valid.Contains(name))
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }

        private static List<LogEntry> ReadLogEntriesShared(string path)
        {
            byte[] bytes;
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using (var memory = new MemoryStream())
            {
                stream.CopyTo(memory);
                bytes = memory.ToArray();
            }

            var entries = new List<LogEntry>();
            var lineStart = 0;
            var lineNumber = 1;
            for (var i = 0; i < bytes.Length; i++)
            {
                if (bytes[i] != (byte)'\n')
                    continue;

                var lineEnd = i > lineStart && bytes[i - 1] == (byte)'\r' ? i - 1 : i;
                entries.Add(new LogEntry
                {
                    LineNumber = lineNumber,
                    Offset = lineStart,
                    Text = DecodeLine(bytes, lineStart, lineEnd - lineStart, lineNumber == 1)
                });
                lineStart = i + 1;
                lineNumber++;
            }

            if (lineStart < bytes.Length)
            {
                entries.Add(new LogEntry
                {
                    LineNumber = lineNumber,
                    Offset = lineStart,
                    Text = DecodeLine(bytes, lineStart, bytes.Length - lineStart, lineNumber == 1)
                });
            }

            return entries;
        }

        private static string DecodeLine(byte[] bytes, int offset, int count, bool firstLine)
        {
            var text = Encoding.UTF8.GetString(bytes, offset, count);
            return firstLine ? text.TrimStart('\uFEFF') : text;
        }

        private static LogSource ResolveEditorLogSource()
        {
            var projectLogPath = GetProjectEditorLogPath();
            if (File.Exists(projectLogPath))
            {
                return new LogSource
                {
                    Source = "project",
                    LogPath = projectLogPath,
                    ProjectLogPath = projectLogPath,
                    FallbackUsed = false,
                    Warning = null
                };
            }

            var hostLogPath = GetHostEditorLogPath();
            return new LogSource
            {
                Source = "host",
                LogPath = hostLogPath,
                ProjectLogPath = projectLogPath,
                FallbackUsed = true,
                Warning = "Project-scoped editor log was not found. This fallback reads the host-wide Unity Editor.log and may include unrelated projects. Start the editor through unictl editor open to create the project log."
            };
        }

        private static string GetProjectEditorLogPath()
        {
            var projectRoot = Directory.GetParent(Application.dataPath).FullName;
            return Path.Combine(projectRoot, "Library", "unictl-state", "editor-current.log");
        }

        private static string GetHostEditorLogPath()
        {
#if UNITY_EDITOR_WIN
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Unity", "Editor", "Editor.log");
#elif UNITY_EDITOR_OSX
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Personal),
                "Library", "Logs", "Unity", "Editor.log");
#else
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Personal),
                ".config", "unity3d", "Editor.log");
#endif
        }

        private static LogReadiness ValidateLogSource(LogSource logSource)
        {
            var editorPid = Process.GetCurrentProcess().Id;
            var processStartedAt = GetProcessStartedAtUtc();
            var logExists = File.Exists(logSource.LogPath);
            var projectLogExists = File.Exists(logSource.ProjectLogPath);
            var logLastWriteAt = logExists ? (DateTime?)File.GetLastWriteTimeUtc(logSource.LogPath) : null;

            var baseData = new LogReadiness
            {
                Usable = true,
                Source = logSource.Source,
                FallbackUsed = logSource.FallbackUsed,
                Warning = logSource.Warning,
                LogPath = logSource.LogPath,
                ProjectLogPath = logSource.ProjectLogPath,
                LogExists = logExists,
                ProjectLogExists = projectLogExists,
                EditorPid = editorPid,
                EditorProcessStartedAt = processStartedAt,
                LogLastWriteAt = logLastWriteAt,
                LogIsCurrentSession = null,
                RequiresEditorRestart = false,
                RecommendedCommand = null,
                Kind = null,
                Message = null
            };

            if (!logExists)
            {
                baseData.Usable = false;
                baseData.Kind = "editor_log_unavailable";
                baseData.Message = $"Project-scoped editor log not found: {logSource.ProjectLogPath}";
                baseData.Warning = "The current editor was probably not started through unictl editor open/restart, so unictl cannot guarantee project-scoped live editor_log data.";
                baseData.RequiresEditorRestart = true;
                baseData.RecommendedCommand = "unictl editor restart";
                return baseData;
            }

            if (logSource.FallbackUsed)
            {
                baseData.Usable = false;
                baseData.Kind = "editor_log_project_log_missing";
                baseData.Message = "Project-scoped editor log is missing; refusing to read the host-wide Unity Editor.log as current-session data.";
                baseData.Warning = "Start or restart the editor with unictl so Unity writes Library/unictl-state/editor-current.log for this project.";
                baseData.LogPath = logSource.ProjectLogPath;
                baseData.LogExists = false;
                baseData.RequiresEditorRestart = true;
                baseData.RecommendedCommand = "unictl editor restart";
                return baseData;
            }

            if (processStartedAt.HasValue && logLastWriteAt.HasValue)
            {
                var staleThreshold = processStartedAt.Value.AddSeconds(-5);
                if (logLastWriteAt.Value < staleThreshold)
                {
                    baseData.Usable = false;
                    baseData.Kind = "editor_log_stale_session";
                    baseData.Message = "Project-scoped editor log predates the current Unity editor process; refusing to return stale log data.";
                    baseData.Warning = "The editor may have been started outside unictl while an old Library/unictl-state/editor-current.log remained on disk.";
                    baseData.LogIsCurrentSession = false;
                    baseData.RequiresEditorRestart = true;
                    baseData.RecommendedCommand = "unictl editor restart";
                    return baseData;
                }

                baseData.LogIsCurrentSession = true;
            }

            return baseData;
        }

        private static DateTime? GetProcessStartedAtUtc()
        {
            try
            {
                return Process.GetCurrentProcess().StartTime.ToUniversalTime();
            }
            catch
            {
                return null;
            }
        }

        private class LogSource
        {
            public string Source;
            public string LogPath;
            public string ProjectLogPath;
            public bool FallbackUsed;
            public string Warning;
        }

        private class LogEntry
        {
            public int LineNumber;
            public long Offset;
            public string Text;
        }

        private class LogReadiness
        {
            public bool Usable;
            public string Source;
            public bool FallbackUsed;
            public string Warning;
            public string LogPath;
            public string ProjectLogPath;
            public bool LogExists;
            public bool ProjectLogExists;
            public int EditorPid;
            public DateTime? EditorProcessStartedAt;
            public DateTime? LogLastWriteAt;
            public bool? LogIsCurrentSession;
            public bool RequiresEditorRestart;
            public string RecommendedCommand;
            public string Kind;
            public string Message;

            public ErrorResponse ToErrorResponse()
            {
                return new ErrorResponse(Message, With(new
                {
                    kind = Kind
                }));
            }

            public object With(object payload)
            {
                var data = JObject.FromObject(payload ?? new { });
                data["source"] = Source;
                data["fallback_used"] = FallbackUsed;
                data["warning"] = Warning;
                data["log_path"] = LogPath;
                data["project_log_path"] = ProjectLogPath;
                data["log_exists"] = LogExists;
                data["project_log_exists"] = ProjectLogExists;
                data["editor_pid"] = EditorPid;
                data["editor_process_started_at"] = FormatUtc(EditorProcessStartedAt);
                data["log_last_write_at"] = FormatUtc(LogLastWriteAt);
                data["log_is_current_session"] = LogIsCurrentSession.HasValue ? JToken.FromObject(LogIsCurrentSession.Value) : JValue.CreateNull();
                data["requires_editor_restart"] = RequiresEditorRestart;
                data["recommended_command"] = RecommendedCommand;
                return data;
            }

            private static string FormatUtc(DateTime? value)
            {
                return value.HasValue ? value.Value.ToString("o") : null;
            }
        }
    }
}
