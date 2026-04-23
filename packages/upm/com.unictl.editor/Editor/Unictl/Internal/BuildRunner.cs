using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Unictl.Internal
{
    /// <summary>
    /// WebForge 패턴 단순화 — Lock/Semaphore/heartbeat/recovery 전부 제거.
    /// EditorApplication.update OneShot + static 상태 변수만 사용.
    /// </summary>
    public static class BuildRunner
    {
        // 단일 활성 jobId — concurrent build 방지
        static string _activeJobId = null;

        // OneShot 콜백에 파라미터 전달용 (WebForge 패턴)
        static string _pendingJobId;
        static BuildParams _pendingParams;

        public enum State { Queued, Running, Done, Failed }

        // ---------------------------------
        // Public API
        // ---------------------------------

        /// <summary>현재 활성 job ID (BuildStatusTool 등에서 참조)</summary>
        public static string ActiveJobId => _activeJobId;

        /// <summary>
        /// IPC/batchmode 공통 진입점 — WebForge 스타일 OneShot 스케줄.
        /// 즉시 반환하고 다음 EditorApplication.update 틱에 빌드 실행.
        /// </summary>
        public static JObject ScheduleBuild(BuildParams p, string jobId)
        {
            // Concurrent build 방지
            if (_activeJobId != null)
                return BuildError("editor_busy", "Another build is already running.", $"job_id={_activeJobId}");

            // 에디터 상태 체크
            if (EditorApplication.isCompiling)
                return BuildError("editor_busy", "Editor is compiling. Wait for compilation to finish.", null);
            if (EditorApplication.isUpdating)
                return BuildError("editor_busy", "Editor is updating (AssetDatabase). Wait for it to finish.", null);

            // BuildTarget 지원 여부
            var parseErr = TryParseBuildTarget(p.Target, out var group, out var target);
            if (parseErr != null)
                return BuildError("invalid_param", parseErr, null);
            if (!BuildPipeline.IsBuildTargetSupported(group, target))
                return BuildError("target_unsupported", $"BuildTarget '{p.Target}' is not supported by this Unity installation.", null);

            // define_symbols 유효성 검사 (§3.2)
            if (p.DefineSymbols != null && p.DefineSymbols.Length > 0)
            {
                var defineErr = ValidateDefineSymbols(p.DefineSymbols);
                if (defineErr != null)
                    return BuildError(defineErr.Kind, defineErr.Message, null);
            }

            // build_path 유효성
            if (!string.IsNullOrEmpty(p.BuildPath))
            {
                if (p.BuildPath.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
                    return BuildError("invalid_param", $"build_path contains invalid characters: {p.BuildPath}", null);
            }

            // 활성 표시 + queued 상태 기록
            _activeJobId = jobId;
            WriteProgress(jobId, State.Queued, p, null, null, null);

            // OneShot 등록 (WebForge 패턴)
            _pendingJobId = jobId;
            _pendingParams = p;
            EditorApplication.update += OneShotBuild;

            return new JObject
            {
                ["ok"] = true,
                ["job_id"] = jobId,
                ["state"] = "queued",
                ["progress_file"] = $"Library/unictl-builds/{jobId}.json",
            };
        }

        // ---------------------------------
        // OneShot callback
        // ---------------------------------

        static void OneShotBuild()
        {
            EditorApplication.update -= OneShotBuild;

            var jobId = _pendingJobId;
            var p = _pendingParams;
            _pendingJobId = null;
            _pendingParams = null;

            try
            {
                // 다음 틱 재확인 (컴파일 등이 끼어들 경우 대비)
                if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                {
                    WriteProgress(jobId, State.Failed, p, null, null,
                        new ErrorInfo("editor_busy", "Editor became busy before build could start."));
                    _activeJobId = null;
                    if (Application.isBatchMode) EditorApplication.Exit(3);
                    return;
                }

                WriteProgress(jobId, State.Running, p, null, null, null);

                var opts = BuildBuildPlayerOptions(p);
                var report = BuildPipeline.BuildPlayer(opts);
                var summary = report.summary;
                var terminal = summary.result == BuildResult.Succeeded ? State.Done : State.Failed;

                // Phase 2b: 빌드 성공 시에만 산출물 메타데이터 계산
                JObject metadata = null;
                if (terminal == State.Done)
                {
                    try
                    {
                        TryParseBuildTarget(p.Target, out _, out var builtTarget);
                        metadata = BuildMetadata.Compute(summary.outputPath, builtTarget);
                    }
                    catch (Exception metaEx)
                    {
                        Debug.LogWarning($"[unictl] BuildMetadata.Compute failed (non-fatal): {metaEx.Message}");
                    }
                }

                WriteProgress(jobId, terminal, p, summary, metadata, terminal == State.Failed
                    ? new ErrorInfo("build_failed",
                        $"Build {summary.result}: {summary.totalErrors} error(s), {summary.totalWarnings} warning(s).")
                    : null);

                if (Application.isBatchMode)
                    EditorApplication.Exit(terminal == State.Done ? 0 : 1);
            }
            catch (Exception ex)
            {
                WriteProgress(jobId, State.Failed, p, null, null,
                    new ErrorInfo("build_exception", $"{ex.GetType().Name}: {ex.Message}"));
                if (Application.isBatchMode) EditorApplication.Exit(1);
            }
            finally
            {
                _activeJobId = null;
            }
        }

        // ---------------------------------
        // Progress file writer
        // ---------------------------------

        static void WriteProgress(string jobId, State state, BuildParams p, BuildSummary? summary, JObject metadata, ErrorInfo err)
        {
            try
            {
                var progress = new JObject
                {
                    ["schema_version"] = 1,
                    ["job_id"] = jobId,
                    ["owner_pid"] = System.Diagnostics.Process.GetCurrentProcess().Id,
                    ["lane"] = Application.isBatchMode ? "batch" : "ipc",
                    ["state"] = state.ToString().ToLower(),
                    ["started_at"] = DateTime.UtcNow.ToString("o"),
                    ["params_echo"] = p?.ToRedactedEcho(),
                };

                if (summary.HasValue)
                {
                    progress["finished_at"] = DateTime.UtcNow.ToString("o");
                    var reportSummary = new JObject
                    {
                        ["result"] = summary.Value.result.ToString(),
                        ["total_errors"] = summary.Value.totalErrors,
                        ["total_warnings"] = summary.Value.totalWarnings,
                        ["output_path"] = summary.Value.outputPath,
                        ["build_time_ms"] = (long)summary.Value.totalTime.TotalMilliseconds,
                    };

                    // Phase 2b: 산출물 메타데이터 필드 병합
                    if (metadata != null)
                    {
                        foreach (var prop in metadata.Properties())
                            reportSummary[prop.Name] = prop.Value;
                    }

                    progress["report_summary"] = reportSummary;
                }

                if (err != null)
                {
                    progress["error"] = new JObject
                    {
                        ["kind"] = err.Kind,
                        ["message"] = err.Message,
                        ["hint"] = err.Hint ?? HintTable.Get(err.Kind),
                    };
                }

                var dir = GetBuildsDir();
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, $"{jobId}.json");
                var tmp = path + ".tmp";
                File.WriteAllText(tmp, progress.ToString(), Encoding.UTF8);
                if (File.Exists(path)) File.Replace(tmp, path, null);
                else File.Move(tmp, path);
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[unictl] WriteProgress failed for job {jobId}: {ex.Message}");
            }
        }

        // ---------------------------------
        // Helpers
        // ---------------------------------

        static JObject BuildError(string kind, string message, string detail)
        {
            return new JObject
            {
                ["ok"] = false,
                ["error"] = new JObject
                {
                    ["kind"] = kind,
                    ["message"] = message,
                    ["hint"] = HintTable.Get(kind),
                    ["detail"] = detail,
                },
            };
        }

        static string TryParseBuildTarget(string targetStr, out BuildTargetGroup group, out BuildTarget target)
        {
            if (string.IsNullOrEmpty(targetStr))
            {
                target = EditorUserBuildSettings.activeBuildTarget;
                group = BuildPipeline.GetBuildTargetGroup(target);
                return null;
            }
            if (!Enum.TryParse<BuildTarget>(targetStr, true, out target))
            {
                group = BuildTargetGroup.Unknown;
                return $"Unknown BuildTarget: '{targetStr}'. Valid values: StandaloneWindows64, StandaloneLinux64, StandaloneOSX, Android, iOS, WebGL";
            }
            group = BuildPipeline.GetBuildTargetGroup(target);
            return null;
        }

        static ErrorInfo ValidateDefineSymbols(string[] symbols)
        {
            var pattern = new Regex(@"^[A-Za-z_][A-Za-z0-9_]*(=[^\s;&|`$]*)?$");
            if (symbols.Length > 128)
                return new ErrorInfo("invalid_param", $"define_symbols exceeds 128 entries limit (got {symbols.Length}).");
            int totalBytes = 0;
            foreach (var sym in symbols)
            {
                totalBytes += Encoding.UTF8.GetByteCount(sym);
                if (!pattern.IsMatch(sym))
                    return new ErrorInfo("invalid_param",
                        $"define_symbols entry has invalid format: '{sym}'. Must match ^[A-Za-z_][A-Za-z0-9_]*(=[^\\s;&|`$]*)?$");
            }
            if (totalBytes > 4 * 1024)
                return new ErrorInfo("invalid_param", $"define_symbols total size exceeds 4 KiB limit ({totalBytes} bytes).");
            return null;
        }

        static BuildPlayerOptions BuildBuildPlayerOptions(BuildParams p)
        {
            TryParseBuildTarget(p.Target, out var group, out var target);

            string[] scenes;
            if (p.Scenes != null && p.Scenes.Length > 0)
                scenes = p.Scenes;
            else
                scenes = EditorBuildSettings.scenes.Where(s => s.enabled).Select(s => s.path).ToArray();

            string buildPath;
            if (!string.IsNullOrEmpty(p.BuildPath))
            {
                var root = GetProjectRoot();
                buildPath = Path.IsPathRooted(p.BuildPath) ? p.BuildPath : Path.Combine(root, p.BuildPath);
            }
            else
            {
                var productName = PlayerSettings.productName ?? "Build";
                buildPath = Path.Combine(GetProjectRoot(), "Build", target.ToString(), productName + GetExeExtension(target));
            }

            var buildOptions = BuildOptions.None;
            if (p.Options != null)
            {
                if (p.Options.Development) buildOptions |= BuildOptions.Development;
                if (p.Options.AllowDebugging) buildOptions |= BuildOptions.AllowDebugging;
                if (p.Options.EnableDeepProfiling) buildOptions |= BuildOptions.EnableDeepProfilingSupport;
                if (p.Options.ConnectProfiler) buildOptions |= BuildOptions.ConnectWithProfiler;
            }

            return new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = buildPath,
                target = target,
                targetGroup = group,
                options = buildOptions,
            };
        }

        static string GetExeExtension(BuildTarget target)
        {
            switch (target)
            {
                case BuildTarget.StandaloneWindows:
                case BuildTarget.StandaloneWindows64: return ".exe";
                case BuildTarget.StandaloneOSX: return ".app";
                default: return "";
            }
        }

        internal static string GetBuildsDir() =>
            Path.Combine(GetProjectRoot(), "Library", "unictl-builds");

        internal static string GetProjectRoot() =>
            Path.GetDirectoryName(Application.dataPath);

        internal static bool ProcessExists(int pid)
        {
            try { System.Diagnostics.Process.GetProcessById(pid); return true; }
            catch { return false; }
        }
    }

    // ---------------------------------
    // BuildParams — §3 Parameter Schema
    // ---------------------------------

    public class BuildParams
    {
        public string Target { get; set; }
        public string BuildPath { get; set; }
        public string[] Scenes { get; set; }
        public string[] DefineSymbols { get; set; }
        public string BuildProfile { get; set; }
        public BuildOptionsParams Options { get; set; }
        public JObject Env { get; set; }
        public int TimeoutSec { get; set; }
        public string LogLevel { get; set; } = "info";
        public string JobId { get; set; }

        public class BuildOptionsParams
        {
            public bool Development { get; set; }
            public bool AllowDebugging { get; set; }
            public bool EnableDeepProfiling { get; set; }
            public bool EnableCodeCoverage { get; set; }
            public bool ConnectProfiler { get; set; }
        }

        public static BuildParams FromJObject(JObject parameters)
        {
            if (parameters == null) return new BuildParams();

            var p = new BuildParams
            {
                Target = parameters["target"]?.ToString(),
                BuildPath = parameters["build_path"]?.ToString(),
                BuildProfile = parameters["build_profile"]?.ToString(),
                TimeoutSec = parameters["timeout_sec"]?.ToObject<int>() ?? 0,
                LogLevel = parameters["log_level"]?.ToString() ?? "info",
                JobId = parameters["job_id"]?.ToString(),
            };

            var scenesToken = parameters["scenes"];
            if (scenesToken != null)
            {
                if (scenesToken.Type == JTokenType.Array)
                    p.Scenes = scenesToken.ToObject<string[]>();
                else
                {
                    var s = scenesToken.ToString();
                    p.Scenes = string.IsNullOrEmpty(s) ? null
                        : s.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
                }
            }

            var defineToken = parameters["define_symbols"];
            if (defineToken != null)
            {
                if (defineToken.Type == JTokenType.Array)
                    p.DefineSymbols = defineToken.ToObject<string[]>();
                else
                {
                    var s = defineToken.ToString();
                    p.DefineSymbols = string.IsNullOrEmpty(s) ? null
                        : s.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
                }
            }

            var optToken = parameters["options"] as JObject;
            if (optToken != null)
            {
                p.Options = new BuildOptionsParams
                {
                    Development = optToken["development"]?.ToObject<bool>() ?? false,
                    AllowDebugging = optToken["allow_debugging"]?.ToObject<bool>() ?? false,
                    EnableDeepProfiling = optToken["enable_deep_profiling"]?.ToObject<bool>() ?? false,
                    EnableCodeCoverage = optToken["enable_code_coverage"]?.ToObject<bool>() ?? false,
                    ConnectProfiler = optToken["connect_profiler"]?.ToObject<bool>() ?? false,
                };
            }

            p.Env = parameters["env"] as JObject;
            return p;
        }

        /// <summary>§3.1 Redaction: env/define_symbols에서 민감한 키/값 redact.</summary>
        public JObject ToRedactedEcho()
        {
            var obj = new JObject
            {
                ["target"] = Target,
                ["build_path"] = BuildPath,
                ["timeout_sec"] = TimeoutSec,
                ["log_level"] = LogLevel,
                ["job_id"] = JobId,
            };

            if (Scenes != null)
                obj["scenes"] = JArray.FromObject(Scenes);

            var redactedFields = new JArray();

            if (DefineSymbols != null)
            {
                var redactedDefines = new JArray();
                for (int i = 0; i < DefineSymbols.Length; i++)
                {
                    var sym = DefineSymbols[i];
                    if (IsSensitiveKey(sym))
                    {
                        redactedDefines.Add("[REDACTED]");
                        redactedFields.Add($"/define_symbols/{i}");
                    }
                    else if (sym.Contains("="))
                    {
                        var eqIdx = sym.IndexOf('=');
                        var key = sym.Substring(0, eqIdx);
                        if (IsSensitiveKey(key))
                        {
                            redactedDefines.Add($"{key}=[REDACTED]");
                            redactedFields.Add($"/define_symbols/{i}/value");
                        }
                        else
                            redactedDefines.Add(sym);
                    }
                    else
                        redactedDefines.Add(sym);
                }
                obj["define_symbols"] = redactedDefines;
            }

            if (Env != null)
            {
                var redactedEnv = new JObject();
                foreach (var prop in Env.Properties())
                {
                    if (IsSensitiveKey(prop.Name))
                    {
                        redactedEnv[prop.Name] = "[REDACTED]";
                        redactedFields.Add($"/env/{prop.Name}");
                    }
                    else
                        redactedEnv[prop.Name] = prop.Value;
                }
                obj["env"] = redactedEnv;
            }

            obj["redacted_fields"] = redactedFields;
            return obj;
        }

        static readonly string[] _sensitivePatterns =
            { "TOKEN", "KEY", "SECRET", "PASSWORD", "PWD", "APIKEY", "PRIVATE_KEY", "PAT" };

        static bool IsSensitiveKey(string key)
        {
            if (string.IsNullOrEmpty(key)) return false;
            var upper = key.ToUpperInvariant();
            foreach (var pat in _sensitivePatterns)
                if (upper.Contains(pat)) return true;
            return false;
        }
    }

    // ---------------------------------
    // ErrorInfo
    // ---------------------------------

    public class ErrorInfo
    {
        public string Kind { get; }
        public string Message { get; }

        public ErrorInfo(string kind, string message)
        {
            Kind = kind;
            Message = message;
        }

        public string Hint => HintTable.Get(Kind);
    }
}
