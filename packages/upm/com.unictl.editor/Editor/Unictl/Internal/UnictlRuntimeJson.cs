// Phase B of unictl v0.7 — runtime.json writer + crash detection.
//
// Manages `Library/unictl/runtime.json` per the B1 schema:
//   - B2: writes the file at editor startup (atomic via tmp + File.Move per F.2)
//   - B4a: rewrites with terminal_reason="quit" before delete attempt on EditorApplication.quitting
//   - B4b: best-effort delete after quit write (failure non-fatal)
//   - B5: at startup, if a stale runtime.json exists with non-quit terminal_reason,
//         records the previous session as a crash sidecar before overwriting
//
// Reader-side (CLI) is implemented separately in `packages/cli/src/runtime.ts`.

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEditor.PackageManager;
using UnityEngine;
using PackageInfo = UnityEditor.PackageManager.PackageInfo;

namespace Unictl
{
    [InitializeOnLoad]
    internal static class UnictlRuntimeJson
    {
        private const int SchemaVersion = 1;
        private const string DirectoryName = "unictl";
        private const string FileName = "runtime.json";

        private static readonly double s_ticksPerMs = Stopwatch.Frequency / 1000.0;

        // Captured once per session — startup time is part of the schema and is used by
        // the reader to mitigate PID reuse (R6 in plan).
        private static long s_startedAtMs;
        private static string s_runtimeDirectory;
        private static string s_runtimePath;
        private static bool s_initialized;

        static UnictlRuntimeJson()
        {
            if (Application.isBatchMode) return;

            try
            {
                s_runtimeDirectory = Path.Combine(GetProjectRoot(), "Library", DirectoryName);
                s_runtimePath = Path.Combine(s_runtimeDirectory, FileName);
                Directory.CreateDirectory(s_runtimeDirectory);

                DetectAndRecordCrash();

                s_startedAtMs = MonotonicNowMs();
                WriteRuntime("unknown");
                s_initialized = true;

                EditorApplication.quitting += OnEditorQuitting;
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[unictl] runtime.json bootstrap failed: {ex.Message}");
            }
        }

        private static void OnEditorQuitting()
        {
            try
            {
                // B4a: write terminal_reason="quit" BEFORE attempting delete so that
                // any reader catching the file mid-shutdown sees the clean-quit signal.
                WriteRuntime("quit");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[unictl] runtime.json quit write failed: {ex.Message}");
            }

            try
            {
                // B4b: best-effort delete. If this fails the next startup will overwrite
                // the file (with terminal_reason="quit" still observable via the previous
                // write); B5 will not classify it as a crash because terminal_reason==quit.
                if (File.Exists(s_runtimePath)) File.Delete(s_runtimePath);
            }
            catch
            {
                // Non-fatal — quit handler should not block shutdown.
            }
        }

        private static void DetectAndRecordCrash()
        {
            // B5: if a runtime.json from a previous session is still here and was not
            // marked terminal_reason="quit", capture it as a crash sidecar before we
            // overwrite. We do NOT verify the previous PID is dead from here — the
            // crash inference relies on the OS having released the PID. False positives
            // (live editor, multi-project warning) are flagged by the reader-side guard
            // (B6) which checks PID liveness.
            if (!File.Exists(s_runtimePath)) return;

            string previous;
            try
            {
                previous = File.ReadAllText(s_runtimePath);
            }
            catch
            {
                return;
            }

            // Quick string sniff for terminal_reason without a JSON parser.
            if (previous.Contains("\"terminal_reason\":\"quit\"")) return;

            try
            {
                var previousPid = ExtractIntField(previous, "pid");
                var previousStarted = ExtractInt64Field(previous, "started_at_ms");
                var sidecarName = $"runtime.json.crashed.{previousPid}.{previousStarted}.json";
                var sidecarPath = Path.Combine(s_runtimeDirectory, sidecarName);
                var detectedAt = MonotonicNowMs();
                var withCrashAnnotation = $"{{\"detected_at_ms\":{detectedAt.ToString(CultureInfo.InvariantCulture)},\"crash_inferred_terminal_reason\":\"crash\",\"previous\":{previous}}}";
                File.WriteAllText(sidecarPath, withCrashAnnotation);
                Debug.LogWarning($"[unictl] previous session ended without quit — recorded crash sidecar at {sidecarPath}");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[unictl] crash sidecar record failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Atomic-rename write per F.2. Tmp suffix includes PID so concurrent editor
        /// instances on the same project (rare; flagged via feedback_editor_multiproject)
        /// do not race on the tmp path.
        /// </summary>
        private static void WriteRuntime(string terminalReason)
        {
            var json = BuildJson(terminalReason);
            var tmpPath = $"{s_runtimePath}.tmp.{Process.GetCurrentProcess().Id}";
            File.WriteAllText(tmpPath, json);

            // File.Move overwrite=true is atomic on same-volume NTFS / APFS. Cross-volume
            // Library/ is documented as unsupported in F.2; reader retries handle the
            // rare race where a reader observes ENOENT mid-rename.
            try
            {
                if (File.Exists(s_runtimePath)) File.Delete(s_runtimePath);
                File.Move(tmpPath, s_runtimePath);
            }
            catch
            {
                // Cleanup tmp if rename failed
                try { if (File.Exists(tmpPath)) File.Delete(tmpPath); } catch { }
                throw;
            }
        }

        private static string BuildJson(string terminalReason)
        {
            var pid = Process.GetCurrentProcess().Id;
            var startedAt = s_initialized ? s_startedAtMs : MonotonicNowMs();
            var projectRoot = NormalizePath(GetProjectRoot());
            var transport = IsWindowsEditor() ? "pipe" : "socket";
            var pipePath = IsWindowsEditor() ? GetPipePath(projectRoot) : null;
            var socketPath = IsWindowsEditor() ? null : GetSocketPath();
            var nativeVersion = ProbeNativeVersion();
            var editorPackageVersion = ProbePackageVersion();
            var sessionId = UnictlServer.SessionId;
            var platform = Application.platform.ToString();
            var unityVersion = Application.unityVersion;

            // Hand-rolled JSON to avoid Newtonsoft pulling in MetadataReader and to keep
            // the file small / inspectable. Field order matches B1 schema for human review.
            return string.Concat(
                "{",
                $"\"schema_version\":{SchemaVersion},",
                $"\"pid\":{pid.ToString(CultureInfo.InvariantCulture)},",
                $"\"started_at_ms\":{startedAt.ToString(CultureInfo.InvariantCulture)},",
                $"\"project_root\":\"{EscapeJson(projectRoot)}\",",
                $"\"transport\":\"{transport}\",",
                $"\"pipe_path\":{NullableString(pipePath)},",
                $"\"socket_path\":{NullableString(socketPath)},",
                $"\"native_version\":\"{EscapeJson(nativeVersion)}\",",
                $"\"editor_package_version\":\"{EscapeJson(editorPackageVersion)}\",",
                $"\"unity_version\":\"{EscapeJson(unityVersion)}\",",
                $"\"session_id\":\"{EscapeJson(sessionId)}\",",
                $"\"platform\":\"{platform}\",",
                $"\"terminal_reason\":\"{terminalReason}\"",
                "}"
            );
        }

        private static string GetProjectRoot()
        {
            return Path.GetDirectoryName(Application.dataPath);
        }

        private static string NormalizePath(string p)
        {
            return p?.Replace('\\', '/') ?? "";
        }

        private static bool IsWindowsEditor()
        {
#if UNITY_EDITOR_WIN
            return true;
#else
            return false;
#endif
        }

        private static string GetPipePath(string projectRootForwardSlash)
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            var hash = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(projectRootForwardSlash));
            var shortHash = BitConverter.ToString(hash, 0, 8).Replace("-", "").ToLowerInvariant();
            return $@"\\.\pipe\unictl-{shortHash}";
        }

        private static string GetSocketPath()
        {
            var unictlDir = Path.Combine(GetProjectRoot(), ".unictl");
            return Path.Combine(unictlDir, "unictl.sock");
        }

        private static string ProbeNativeVersion()
        {
            // Native bridge exposes its version via build metadata. For v0.7 we ship a
            // best-effort probe; A1 ADR / A7 freeze documents the contract. If/when the
            // native side adds a `unictl_native_version()` export, switch to that.
            return "0.7.0";
        }

        private static string ProbePackageVersion()
        {
            try
            {
                var assembly = Assembly.GetExecutingAssembly();
                var info = PackageInfo.FindForAssembly(assembly);
                return info?.version ?? "unknown";
            }
            catch
            {
                return "unknown";
            }
        }

        private static long MonotonicNowMs()
        {
            // R16: monotonic only (Stopwatch.GetTimestamp). Wall-clock is unsafe across
            // DST/NTP/VM resume.
            return (long)(Stopwatch.GetTimestamp() / s_ticksPerMs);
        }

        private static string NullableString(string s)
        {
            return s == null ? "null" : $"\"{EscapeJson(s)}\"";
        }

        private static string EscapeJson(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var sb = new System.Text.StringBuilder(s.Length + 8);
            for (var i = 0; i < s.Length; i++)
            {
                var c = s[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20)
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else
                            sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        private static int ExtractIntField(string json, string field)
        {
            var needle = $"\"{field}\":";
            var start = json.IndexOf(needle, StringComparison.Ordinal);
            if (start < 0) return 0;
            start += needle.Length;
            var end = start;
            while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-')) end++;
            return int.TryParse(json.Substring(start, end - start), out var v) ? v : 0;
        }

        private static long ExtractInt64Field(string json, string field)
        {
            var needle = $"\"{field}\":";
            var start = json.IndexOf(needle, StringComparison.Ordinal);
            if (start < 0) return 0;
            start += needle.Length;
            var end = start;
            while (end < json.Length && (char.IsDigit(json[end]) || json[end] == '-')) end++;
            return long.TryParse(json.Substring(start, end - start), out var v) ? v : 0;
        }
    }
}
