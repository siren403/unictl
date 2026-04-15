using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace Unictl.Tools
{
    [UnictlTool(Name = "editor_log", Description = "Read Unity editor logs: tail, search, or get recent runtime logs")]
    public static class EditorLogTool
    {
        private static readonly List<LogEntry> RuntimeLogs = new List<LogEntry>();
        private const int MaxRuntimeLogs = 500;

        static EditorLogTool()
        {
            Application.logMessageReceived += OnLogMessage;
        }

        public class Parameters
        {
            [ToolParameter("Action: tail, search, runtime, clear", Required = true)]
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
                case "runtime": return DoRuntime(p);
                case "clear": return DoClear();
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

            return new SuccessResponse("Editor log tail", new
            {
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

            return new SuccessResponse($"Found {matches.Length} matches for '{pattern}'", new
            {
                log_path = logPath,
                pattern,
                matches
            });
        }

        private static object DoRuntime(ToolParams p)
        {
            var count = p.GetInt("lines", 50).Value;
            var level = p.Get("level");

            List<LogEntry> filtered;
            lock (RuntimeLogs)
            {
                filtered = level != null
                    ? RuntimeLogs.Where(e => string.Equals(e.level, level, StringComparison.OrdinalIgnoreCase)).ToList()
                    : new List<LogEntry>(RuntimeLogs);
            }

            var result = filtered.TakeLast(count).ToArray();

            return new SuccessResponse($"Runtime logs ({result.Length} entries)", new
            {
                total_captured = RuntimeLogs.Count,
                returned = result.Length,
                filter_level = level,
                entries = result
            });
        }

        private static object DoClear()
        {
            int count;
            lock (RuntimeLogs)
            {
                count = RuntimeLogs.Count;
                RuntimeLogs.Clear();
            }
            return new SuccessResponse($"Cleared {count} runtime log entries");
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

            lock (RuntimeLogs)
            {
                RuntimeLogs.Add(entry);
                if (RuntimeLogs.Count > MaxRuntimeLogs)
                    RuntimeLogs.RemoveAt(0);
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
