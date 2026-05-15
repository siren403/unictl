using System;
using System.Collections.Generic;
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

            if (!File.Exists(logPath))
                return new ErrorResponse($"Editor log not found: {logPath}");

            var allLines = ReadLinesShared(logPath);
            var start = Math.Max(0, allLines.Count - lines);
            var result = allLines.Skip(start).ToArray();

            return new SuccessResponse("Editor log tail (file-based, includes compile errors)", new
            {
                source = logSource.Source,
                fallback_used = logSource.FallbackUsed,
                warning = logSource.Warning,
                includes_compile_errors = true,
                log_path = logPath,
                total_lines = allLines.Count,
                returned_lines = result.Length,
                lines = result
            });
        }

        private static object DoSearch(ToolParams p)
        {
            var (ok, pattern, err) = p.GetRequired("pattern");
            if (!ok) return new ErrorResponse(err);

            var lines = p.GetInt("lines", 100).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            if (!File.Exists(logPath))
                return new ErrorResponse($"Editor log not found: {logPath}");

            var matches = ReadLinesShared(logPath)
                .Select((line, index) => new { line, index })
                .Where(x => x.line.IndexOf(pattern, StringComparison.OrdinalIgnoreCase) >= 0)
                .TakeLast(lines)
                .Select(x => new { line_number = x.index + 1, text = x.line })
                .ToArray();

            return new SuccessResponse($"Found {matches.Length} matches for '{pattern}' (file-based)", new
            {
                source = logSource.Source,
                fallback_used = logSource.FallbackUsed,
                warning = logSource.Warning,
                includes_compile_errors = true,
                log_path = logPath,
                match_mode = "literal_substring",
                pattern,
                matches
            });
        }

        private static object DoErrors(ToolParams p)
        {
            var lines = p.GetInt("lines", 100).Value;
            var logSource = ResolveEditorLogSource();
            var logPath = logSource.LogPath;

            if (!File.Exists(logPath))
                return new ErrorResponse($"Editor log not found: {logPath}");

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
                new
                {
                    source = logSource.Source,
                    fallback_used = logSource.FallbackUsed,
                    warning = logSource.Warning,
                    log_path = logPath,
                    compile_errors = compileTrimmed,
                    exceptions = exceptionsTrimmed,
                    total_count = total
                });
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
                    FallbackUsed = false,
                    Warning = null
                };
            }

            var hostLogPath = GetHostEditorLogPath();
            return new LogSource
            {
                Source = "host",
                LogPath = hostLogPath,
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

        private class LogSource
        {
            public string Source;
            public string LogPath;
            public bool FallbackUsed;
            public string Warning;
        }
    }
}
