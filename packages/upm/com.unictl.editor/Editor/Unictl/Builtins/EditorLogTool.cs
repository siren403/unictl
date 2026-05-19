using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Unictl.Tools
{
    [UnictlTool(Name = "editor_log", Description = "Read Unity editor logs from the project-scoped editor log when available. Use tail/search/errors; game_logs is deprecated.")]
    public static class EditorLogTool
    {
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
            if (!ok) return new ErrorResponse(err);

            switch (action)
            {
                case "tail": return DoTail(p);
                case "search": return DoSearch(p);
                case "errors": return DoErrors(p);
                case "game_logs":
                case "clear_game_logs":
                    return DeprecatedGameLogsResponse(action);
                default:
                    return new ErrorResponse($"Unknown action: {action}");
            }
        }

        private static object DoTail(ToolParams p)
        {
            var lines = p.GetInt("lines", 50).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            var readiness = ValidateLogSource(logSource);
            if (!readiness.Usable)
                return readiness.ToErrorResponse();

            var allLines = ReadLinesShared(logPath);
            var start = Math.Max(0, allLines.Count - lines);
            var result = allLines.Skip(start).ToArray();

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

        private static object DoSearch(ToolParams p)
        {
            var (ok, pattern, err) = p.GetRequired("pattern");
            if (!ok) return new ErrorResponse(err);

            var lines = p.GetInt("lines", 100).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            var readiness = ValidateLogSource(logSource);
            if (!readiness.Usable)
                return readiness.ToErrorResponse();

            var matches = ReadLinesShared(logPath)
                .Select((line, index) => new { line, index })
                .Where(x => x.line.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0)
                .TakeLast(lines)
                .Select(x => new { line_number = x.index + 1, text = x.line })
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

        private static object DoErrors(ToolParams p)
        {
            var lines = p.GetInt("lines", 100).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            var readiness = ValidateLogSource(logSource);
            if (!readiness.Usable)
                return readiness.ToErrorResponse();

            var allLines = ReadLinesShared(logPath);
            var compileErrors = new List<object>();
            var exceptions = new List<object>();

            for (int i = 0; i < allLines.Count; i++)
            {
                var line = allLines[i];
                if (CompileErrorRegex.IsMatch(line))
                    compileErrors.Add(new { line_number = i + 1, text = line });
                else if (ExceptionRegex.IsMatch(line))
                    exceptions.Add(new { line_number = i + 1, text = line });
            }

            var compileTrimmed = compileErrors.TakeLast(lines).ToArray();
            var exceptionsTrimmed = exceptions.TakeLast(lines).ToArray();
            var total = compileTrimmed.Length + exceptionsTrimmed.Length;

            return new SuccessResponse(
                total == 0 ? "No compile errors or exceptions found" : $"Found {compileTrimmed.Length} compile errors, {exceptionsTrimmed.Length} exceptions",
                readiness.With(new
                {
                    source = logSource.Source,
                    fallback_used = logSource.FallbackUsed,
                    log_path = logPath,
                    compile_errors = compileTrimmed,
                    exceptions = exceptionsTrimmed,
                    total_count = total
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

        private static List<string> ReadLinesShared(string path)
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(stream);
            var lines = new List<string>();
            string line;
            while ((line = reader.ReadLine()) != null)
                lines.Add(line);
            return lines;
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
