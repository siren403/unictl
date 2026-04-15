using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Unictl.Tools
{
    [UnictlTool(Name = "editor_log", Description = "Read Unity editor logs. IMPORTANT: compile errors (CSxxxx) only appear in tail/search/errors (file-based), NOT in game_logs (memory-based Debug.Log buffer).")]
    public static class EditorLogTool
    {
        private static readonly List<LogEntry> GameLogs = new List<LogEntry>();
        private const int MaxGameLogs = 500;

        private static readonly Regex CompileErrorRegex = new Regex(@"\berror\s+CS\d{4}\b", RegexOptions.IgnoreCase | RegexOptions.Compiled);
        private static readonly Regex ExceptionRegex = new Regex(@"^\S*Exception:", RegexOptions.Compiled);

        static EditorLogTool()
        {
            Application.logMessageReceived += OnLogMessage;
        }

        public class Parameters
        {
            [ToolParameter("Action: tail, search, errors, game_logs, clear_game_logs. Use 'errors' to check compile/exception failures.", Required = true)]
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
                case "game_logs": return DoGameLogs(p);
                case "clear_game_logs": return DoClearGameLogs();
                default:
                    return new ErrorResponse($"Unknown action: {action}");
            }
        }

        private static object DoTail(ToolParams p)
        {
            var lines = p.GetInt("lines", 50).Value;
            var logPath = GetEditorLogPath();

            if (!File.Exists(logPath))
                return new ErrorResponse($"Editor log not found: {logPath}");

            var allLines = ReadLinesShared(logPath);
            var start = Math.Max(0, allLines.Count - lines);
            var result = allLines.Skip(start).ToArray();

            return new SuccessResponse("Editor log tail (file-based, includes compile errors)", new
            {
                source = "Editor.log file",
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
            var logPath = GetEditorLogPath();

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
                source = "Editor.log file",
                includes_compile_errors = true,
                log_path = logPath,
                pattern,
                matches
            });
        }

        private static object DoErrors(ToolParams p)
        {
            var lines = p.GetInt("lines", 100).Value;
            var logPath = GetEditorLogPath();

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
                    source = "Editor.log file (filtered)",
                    log_path = logPath,
                    compile_errors = compileTrimmed,
                    exceptions = exceptionsTrimmed,
                    total_count = total
                });
        }

        private static object DoGameLogs(ToolParams p)
        {
            var count = p.GetInt("lines", 50).Value;
            var level = p.Get("level");

            List<LogEntry> filtered;
            lock (GameLogs)
            {
                filtered = level != null
                    ? GameLogs.Where(e => string.Equals(e.level, level, StringComparison.OrdinalIgnoreCase)).ToList()
                    : new List<LogEntry>(GameLogs);
            }

            var result = filtered.TakeLast(count).ToArray();

            return new SuccessResponse($"Game logs ({result.Length} entries from Debug.Log buffer — does NOT include compile errors)", new
            {
                source = "Application.logMessageReceived buffer (Debug.Log/LogWarning/LogError only)",
                includes_compile_errors = false,
                hint = "To check compile errors, use action=errors or action=tail/search.",
                total_captured = GameLogs.Count,
                returned = result.Length,
                filter_level = level,
                entries = result
            });
        }

        private static object DoClearGameLogs()
        {
            int count;
            lock (GameLogs)
            {
                count = GameLogs.Count;
                GameLogs.Clear();
            }
            return new SuccessResponse($"Cleared {count} game log entries");
        }

        private static void OnLogMessage(string condition, string stackTrace, LogType type)
        {
            var entry = new LogEntry
            {
                timestamp = DateTime.Now.ToString("HH:mm:ss.fff"),
                level = type.ToString(),
                message = condition,
                stack_trace = type == LogType.Exception || type == LogType.Error ? stackTrace : null
            };

            lock (GameLogs)
            {
                GameLogs.Add(entry);
                if (GameLogs.Count > MaxGameLogs)
                    GameLogs.RemoveAt(0);
            }
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

        private static string GetEditorLogPath()
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

        [Serializable]
        private class LogEntry
        {
            public string timestamp;
            public string level;
            public string message;
            public string stack_trace;
        }
    }
}
