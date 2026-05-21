// Phase A2 of unictl v0.7 — managed heartbeat emitter.
//
// Pushes a state snapshot to native (`unictl_heartbeat`) at 1 Hz from
// EditorApplication.update plus on every phase transition. Native side stores
// the latest payload so the `/liveness` route (added in A3) can answer even
// during a domain reload window when the C# handler is unregistered.
//
// PERF MEASUREMENT (per F.1, deferred to A2 PR review):
// Define UNICTL_HEARTBEAT_PERF in scripting symbols to enable scaffolding.
// Expected (F.1 budget): p99 native call < 200 µs, alloc < 4 KB/s steady-state.
// Live numbers attach to the A2 PR review thread.
//
// Subscription order vs UnictlServer.OnBeforeReload: this class's static
// initializer runs alphabetically before UnictlServer.cs, so its
// `beforeAssemblyReload` handler fires first. The order is not strictly
// required for correctness — `unictl_heartbeat` writes directly into native
// static memory and does not depend on the managed handler being registered —
// but firing first lets the final phase=reloading payload land before the
// pipe shuts down its handler entry point.

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace Unictl
{
    [InitializeOnLoad]
    internal static class UnictlHeartbeat
    {
        // Phase precedence (highest first) — see A1 ADR.
        // Importing reserved for A3+ once EditorApplication.isUpdating tracking lands.
        private enum Phase
        {
            Idle,
            Paused,
            Playing,
            Compiling,
            Reloading,
            Quitting,
        }

        private const int SchemaVersion = 1;
        private const double EmitIntervalSeconds = 1.0;

        // Stopwatch.GetTimestamp() ticks per ms — captured once.
        private static readonly double s_ticksPerMs = Stopwatch.Frequency / 1000.0;

        private static Phase s_phase = Phase.Idle;
        private static string s_cachedJson;
        private static double s_lastEmitTimeSinceStartup = -1.0;
        private static bool s_quitting;
        private static bool s_reloading;
        private static int s_compileSequence;
        private static bool s_compileActive;
        private static string s_compileStartedAt;
        private static string s_compileFinishedAt;
        private static string s_compileContext;
        private static long? s_compileStartedLogPosition;
        private static long? s_compileFinishedLogPosition;
        private static JObject s_lastCompileRequest;

#if UNICTL_HEARTBEAT_PERF
        private const int PerfSampleWindow = 60;
        private static readonly long[] s_perfSamplesUs = new long[PerfSampleWindow];
        private static int s_perfSampleCount;
        private static int s_perfSampleIndex;
        private static long s_perfLastReportTicks;
        private static long s_perfLastAllocBytes;
#endif

        static UnictlHeartbeat()
        {
            if (Application.isBatchMode)
            {
                return;
            }

            // Subscribe before UnictlServer's static ctor wires its own handlers.
            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
            AssemblyReloadEvents.beforeAssemblyReload += OnBeforeReload;
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
            EditorApplication.quitting += OnEditorQuitting;
            EditorApplication.update += OnEditorUpdate;

            // Seed phase + cache from current editor state. Avoids "idle" being reported
            // for the first second when the editor was already compiling at static init.
            LoadCompileLifecycle();
            s_compileActive = EditorApplication.isCompiling;
            WriteCompileLifecycle();
            RefreshPhase(forceEmit: true);
        }

        internal static JObject RecordCompileRequest(string source, bool refreshRequested, bool scriptCompilationRequested)
        {
            var request = new JObject
            {
                ["request_id"] = Guid.NewGuid().ToString("N"),
                ["source"] = source,
                ["requested_at"] = DateTime.UtcNow.ToString("o"),
                ["pre_compile_sequence"] = s_compileSequence,
                ["is_compiling_at_dispatch"] = EditorApplication.isCompiling,
                ["refresh_requested"] = refreshRequested,
                ["script_compilation_requested"] = scriptCompilationRequested,
            };
            s_lastCompileRequest = request;
            WriteCompileLifecycle();
            return (JObject)request.DeepClone();
        }

        internal static JObject CompileLifecycleSnapshot()
        {
            return new JObject
            {
                ["schema_version"] = 1,
                ["sequence"] = s_compileSequence,
                ["is_compiling"] = EditorApplication.isCompiling || s_compileActive,
                ["started_at"] = s_compileStartedAt == null ? JValue.CreateNull() : new JValue(s_compileStartedAt),
                ["finished_at"] = s_compileFinishedAt == null ? JValue.CreateNull() : new JValue(s_compileFinishedAt),
                ["context"] = s_compileContext == null ? JValue.CreateNull() : new JValue(s_compileContext),
                ["started_log_position"] = s_compileStartedLogPosition.HasValue ? new JValue(s_compileStartedLogPosition.Value) : JValue.CreateNull(),
                ["finished_log_position"] = s_compileFinishedLogPosition.HasValue ? new JValue(s_compileFinishedLogPosition.Value) : JValue.CreateNull(),
                ["last_request"] = s_lastCompileRequest == null ? JValue.CreateNull() : (JToken)s_lastCompileRequest.DeepClone(),
            };
        }

        private static void OnCompilationStarted(object context)
        {
            s_compileSequence++;
            s_compileActive = true;
            s_compileStartedAt = DateTime.UtcNow.ToString("o");
            s_compileFinishedAt = null;
            s_compileContext = context?.ToString();
            s_compileStartedLogPosition = CaptureProjectEditorLogPosition();
            s_compileFinishedLogPosition = null;
            WriteCompileLifecycle();
            RefreshPhase(forceEmit: true);
        }

        private static void OnCompilationFinished(object context)
        {
            s_compileActive = false;
            s_compileFinishedAt = DateTime.UtcNow.ToString("o");
            s_compileContext = context?.ToString() ?? s_compileContext;
            s_compileFinishedLogPosition = CaptureProjectEditorLogPosition();
            WriteCompileLifecycle();
            RefreshPhase(forceEmit: true);
        }

        private static void OnBeforeReload()
        {
            s_reloading = true;
            // Push the final phase=reloading payload synchronously. UnictlServer's
            // OnBeforeReload (which calls unictl_unregister_handler) runs after
            // ours by alphabetical [InitializeOnLoad] order, but even if order
            // changes, native unictl_heartbeat does not depend on the handler.
            RefreshPhase(forceEmit: true);
        }

        private static void OnEditorQuitting()
        {
            s_quitting = true;
            RefreshPhase(forceEmit: true);
        }

        private static void OnPlayModeStateChanged(PlayModeStateChange change)
        {
            // Any transition is a phase transition.
            RefreshPhase(forceEmit: true);
        }

        private static void OnEditorUpdate()
        {
            var now = EditorApplication.timeSinceStartup;
            if (s_lastEmitTimeSinceStartup < 0.0 || now - s_lastEmitTimeSinceStartup >= EmitIntervalSeconds)
            {
                RefreshPhase(forceEmit: false);
            }
        }

        private static void RefreshPhase(bool forceEmit)
        {
            var phase = ComputePhase();
            var phaseChanged = phase != s_phase;

            if (phaseChanged)
            {
                s_phase = phase;
                s_cachedJson = null; // invalidate cache; will rebuild on emit
            }

            if (phaseChanged || forceEmit || s_cachedJson == null)
            {
                Emit();
            }
        }

        private static Phase ComputePhase()
        {
            if (s_quitting) return Phase.Quitting;
            if (s_reloading) return Phase.Reloading;
            if (EditorApplication.isCompiling) return Phase.Compiling;
            if (EditorApplication.isPlaying)
            {
                return EditorApplication.isPaused ? Phase.Paused : Phase.Playing;
            }
            return Phase.Idle;
        }

        private static void Emit()
        {
            try
            {
                if (s_cachedJson == null)
                {
                    s_cachedJson = BuildStateJson(s_phase);
                }

                var timestampMs = MonotonicTimestampMs();

#if UNICTL_HEARTBEAT_PERF
                var startTicks = Stopwatch.GetTimestamp();
                var startAlloc = GC.GetAllocatedBytesForCurrentThread();
#endif

                var rc = UnictlNative.unictl_heartbeat(timestampMs, s_cachedJson);

#if UNICTL_HEARTBEAT_PERF
                var endTicks = Stopwatch.GetTimestamp();
                var endAlloc = GC.GetAllocatedBytesForCurrentThread();
                RecordPerfSample(endTicks - startTicks, endAlloc - startAlloc);
#endif

                if (rc != 0)
                {
                    UnityEngine.Debug.LogWarning($"[unictl] heartbeat returned {rc}");
                }

                s_lastEmitTimeSinceStartup = EditorApplication.timeSinceStartup;
            }
            catch (DllNotFoundException)
            {
                // Native DLL missing — likely package not yet imported. Stay quiet.
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[unictl] heartbeat emit failed: {ex.Message}");
            }
        }

        private static long MonotonicTimestampMs()
        {
            // Stopwatch.GetTimestamp() is monotonic on every supported platform
            // (per R16: never use wall clock for staleness math).
            return (long)(Stopwatch.GetTimestamp() / s_ticksPerMs);
        }

        private static string BuildStateJson(Phase phase)
        {
            // Hand-rolled JSON to avoid Newtonsoft allocations on the 1 Hz path.
            // Payload is < 256 bytes so a single StringBuilder is plenty.
            var sb = new StringBuilder(256);
            sb.Append('{');
            AppendField(sb, "schema_version", SchemaVersion); sb.Append(',');
            AppendField(sb, "phase", PhaseToString(phase)); sb.Append(',');
            AppendField(sb, "is_playing", EditorApplication.isPlaying); sb.Append(',');
            AppendField(sb, "is_compiling", EditorApplication.isCompiling); sb.Append(',');
            AppendField(sb, "is_paused", EditorApplication.isPaused); sb.Append(',');
            AppendField(sb, "session_id", UnictlServer.SessionId); sb.Append(',');
            AppendField(sb, "unity_version", Application.unityVersion); sb.Append(',');
            AppendField(sb, "platform", Application.platform.ToString());
            sb.Append('}');
            return sb.ToString();
        }

        private static string PhaseToString(Phase phase)
        {
            switch (phase)
            {
                case Phase.Quitting: return "quitting";
                case Phase.Reloading: return "reloading";
                case Phase.Compiling: return "compiling";
                case Phase.Playing: return "playing";
                case Phase.Paused: return "paused";
                default: return "idle";
            }
        }

        private static void WriteCompileLifecycle()
        {
            try
            {
                var path = GetCompileLifecyclePath();
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.WriteAllText(path, CompileLifecycleSnapshot().ToString(), Encoding.UTF8);
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[unictl] compile lifecycle write failed: {ex.Message}");
            }
        }

        private static void LoadCompileLifecycle()
        {
            try
            {
                var path = GetCompileLifecyclePath();
                if (!File.Exists(path))
                    return;

                JObject existing;
                using (var reader = new JsonTextReader(new StringReader(File.ReadAllText(path, Encoding.UTF8))))
                {
                    reader.DateParseHandling = DateParseHandling.None;
                    existing = JObject.Load(reader);
                }
                s_compileSequence = existing["sequence"]?.ToObject<int>() ?? 0;
                s_compileActive = existing["is_compiling"]?.ToObject<bool>() ?? false;
                s_compileStartedAt = existing["started_at"]?.Type == JTokenType.String
                    ? existing["started_at"]?.ToString()
                    : null;
                s_compileFinishedAt = existing["finished_at"]?.Type == JTokenType.String
                    ? existing["finished_at"]?.ToString()
                    : null;
                s_compileContext = existing["context"]?.Type == JTokenType.String
                    ? existing["context"]?.ToString()
                    : null;
                s_compileStartedLogPosition = existing["started_log_position"]?.Type == JTokenType.Integer
                    ? existing["started_log_position"]?.ToObject<long>()
                    : null;
                s_compileFinishedLogPosition = existing["finished_log_position"]?.Type == JTokenType.Integer
                    ? existing["finished_log_position"]?.ToObject<long>()
                    : null;
                s_lastCompileRequest = existing["last_request"] as JObject;
            }
            catch
            {
                s_compileSequence = 0;
                s_compileActive = false;
                s_compileStartedAt = null;
                s_compileFinishedAt = null;
                s_compileContext = null;
                s_compileStartedLogPosition = null;
                s_compileFinishedLogPosition = null;
                s_lastCompileRequest = null;
            }
        }

        private static string GetCompileLifecyclePath()
        {
            return Path.Combine(Path.GetDirectoryName(Application.dataPath), "Library", "unictl-state", "compile-lifecycle.json");
        }

        private static long? CaptureProjectEditorLogPosition()
        {
            try
            {
                var path = Path.Combine(Path.GetDirectoryName(Application.dataPath), "Library", "unictl-state", "editor-current.log");
                return File.Exists(path) ? new FileInfo(path).Length : (long?)null;
            }
            catch
            {
                return null;
            }
        }

        private static void AppendField(StringBuilder sb, string key, string value)
        {
            sb.Append('"').Append(key).Append("\":\"");
            EscapeJsonString(sb, value ?? string.Empty);
            sb.Append('"');
        }

        private static void AppendField(StringBuilder sb, string key, bool value)
        {
            sb.Append('"').Append(key).Append("\":").Append(value ? "true" : "false");
        }

        private static void AppendField(StringBuilder sb, string key, int value)
        {
            sb.Append('"').Append(key).Append("\":").Append(value.ToString(CultureInfo.InvariantCulture));
        }

        private static void EscapeJsonString(StringBuilder sb, string s)
        {
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
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
        }

#if UNICTL_HEARTBEAT_PERF
        private static void RecordPerfSample(long elapsedTicks, long allocDelta)
        {
            var elapsedUs = (long)(elapsedTicks * 1_000_000.0 / Stopwatch.Frequency);
            s_perfSamplesUs[s_perfSampleIndex] = elapsedUs;
            s_perfSampleIndex = (s_perfSampleIndex + 1) % PerfSampleWindow;
            if (s_perfSampleCount < PerfSampleWindow) s_perfSampleCount++;
            s_perfLastAllocBytes += allocDelta;

            var nowTicks = Stopwatch.GetTimestamp();
            if (s_perfLastReportTicks == 0)
            {
                s_perfLastReportTicks = nowTicks;
                return;
            }

            var sinceReportSeconds = (nowTicks - s_perfLastReportTicks) / (double)Stopwatch.Frequency;
            if (sinceReportSeconds < 60.0) return;

            // Compute p50/p99 over last s_perfSampleCount samples.
            var snapshot = new long[s_perfSampleCount];
            Array.Copy(s_perfSamplesUs, snapshot, s_perfSampleCount);
            Array.Sort(snapshot);
            var p50 = snapshot[snapshot.Length / 2];
            var p99 = snapshot[Math.Min(snapshot.Length - 1, (int)(snapshot.Length * 0.99))];
            var allocPerSec = s_perfLastAllocBytes / sinceReportSeconds;

            UnityEngine.Debug.Log(
                $"[unictl][perf] heartbeat samples={s_perfSampleCount} p50={p50}us p99={p99}us " +
                $"alloc={allocPerSec:F0}B/s window={sinceReportSeconds:F1}s");

            s_perfLastReportTicks = nowTicks;
            s_perfLastAllocBytes = 0;
        }
#endif
    }
}
