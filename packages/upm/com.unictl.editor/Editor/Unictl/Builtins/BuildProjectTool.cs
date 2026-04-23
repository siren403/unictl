using System;
using Newtonsoft.Json.Linq;
using Unictl.Internal;

namespace Unictl.Builtins
{
    [UnictlTool(
        Name = "build_project",
        Description = "Build a Unity player. See: unictl build --help. Long-running; returns {ok,job_id,state:'queued'} immediately. Poll with build_status; cancel with build_cancel.")]
    public static class BuildProjectTool
    {
        public class Parameters
        {
            [ToolParameter("Unity BuildTarget enum value. Examples: StandaloneWindows64, StandaloneLinux64, StandaloneOSX, Android, iOS, WebGL", Required = false, Enum = "StandaloneWindows64,StandaloneLinux64,StandaloneOSX,Android,iOS,WebGL")]
            public string Target { get; set; }

            [ToolParameter("Output path for the build artifacts (default: derived from target + ProductName)", Required = false)]
            public string BuildPath { get; set; }

            [ToolParameter("Comma-separated scene asset paths to include (default: EditorBuildSettings scenes)", Required = false)]
            public string Scenes { get; set; }

            [ToolParameter("Comma-separated scripting define symbols to add, e.g. DEBUG,API_URL=https://example.com (max 128 entries / 4 KiB)", Required = false)]
            public string DefineSymbols { get; set; }

            [ToolParameter("Unity 6+ BuildProfile asset path, e.g. Assets/Profiles/Android-Release.asset (detection lands in P5)", Required = false)]
            public string BuildProfile { get; set; }

            [ToolParameter("Build options flags object: development (bool), allow_debugging (bool), enable_deep_profiling (bool), enable_code_coverage (bool), connect_profiler (bool)", Required = false)]
            public JObject Options { get; set; }

            [ToolParameter("Environment variables to inject as a key-value object (sensitive values are redacted in progress files)", Required = false)]
            public JObject Env { get; set; }

            [ToolParameter("Client-side wait timeout in seconds; 0 = unlimited (default: 0). Fires exit code 124 on timeout; build continues on Unity side.", Required = false, DefaultValue = "0")]
            public string TimeoutSec { get; set; }

            [ToolParameter("Log verbosity: debug, info, warn, error (default: info)", Required = false, DefaultValue = "info", Enum = "debug,info,warn,error")]
            public string LogLevel { get; set; }

            [ToolParameter("Override the auto-generated job identifier for this build (useful for CI traceability)", Required = false)]
            public string JobId { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            // 빈 파라미터 → usage envelope 반환 (plan §2.7(C))
            if (parameters == null || !parameters.HasValues)
            {
                return new SuccessResponse(
                    "Usage: unictl build --target <BuildTarget> [options]",
                    new
                    {
                        kind = "usage",
                        tool = "build_project",
                        description = "Build a Unity player. Auto-routes between live editor (IPC lane) and headless batchmode. Long-running operation; returns job_id immediately. Poll progress with build_status; request cancellation with build_cancel.",
                        quick_start = new[]
                        {
                            "unictl build --target StandaloneWindows64 --wait",
                            "unictl build --target Android --build-profile Assets/Profiles/Android-Release.asset --timeout 3600",
                            "unictl build --target iOS --batch --output Build/iOS --job-id ci-abc123",
                        },
                        parameters = new object[]
                        {
                            new { name = "target", type = "string", required = false, description = "Unity BuildTarget enum value", example = "StandaloneWindows64", @enum = new[] { "StandaloneWindows64", "StandaloneLinux64", "StandaloneOSX", "Android", "iOS", "WebGL" } },
                            new { name = "build_path", type = "string", required = false, description = "Output path for build artifacts (default: derived from target + ProductName)", example = "Build/Windows" },
                            new { name = "scenes", type = "string", required = false, description = "Comma-separated scene paths (default: EditorBuildSettings)", example = "Assets/Scenes/Main.unity,Assets/Scenes/Game.unity" },
                            new { name = "define_symbols", type = "string", required = false, description = "Comma-separated scripting define symbols (max 128 / 4 KiB)", example = "RELEASE,API_BASE=https://example.com" },
                            new { name = "build_profile", type = "string", required = false, description = "Unity 6+ BuildProfile asset path (detection lands in P5)", example = "Assets/Profiles/Android-Release.asset" },
                            new { name = "options", type = "object", required = false, description = "Build options: development, allow_debugging, enable_deep_profiling, enable_code_coverage, connect_profiler (all bool)", example = new { development = true, allow_debugging = false } },
                            new { name = "env", type = "object", required = false, description = "Environment variables to inject (sensitive keys are redacted in progress files)", example = new { BUILD_NUMBER = "42" } },
                            new { name = "timeout_sec", type = "string", required = false, @default = "0", description = "Client-side wait timeout in seconds; 0 = unlimited. Exit code 124 on timeout.", example = "3600" },
                            new { name = "log_level", type = "string", required = false, @default = "info", description = "Log verbosity", @enum = new[] { "debug", "info", "warn", "error" }, example = "info" },
                            new { name = "job_id", type = "string", required = false, description = "Override auto-generated job identifier", example = "ci-abc123" },
                        },
                        companions = new[] { "build_status", "build_cancel" },
                        see_also = new[] { "unictl build --help" },
                    });
            }

            // 파라미터 파싱 (§3)
            BuildParams p;
            try
            {
                p = BuildParams.FromJObject(parameters);
            }
            catch (Exception ex)
            {
                return new ErrorResponse(
                    $"Failed to parse build parameters: {ex.Message}",
                    new { kind = "invalid_param", hint = HintTable.Get("invalid_param") });
            }

            // job_id 결정
            if (string.IsNullOrEmpty(p.JobId))
                p.JobId = Guid.NewGuid().ToString("N");

            // ScheduleBuild — preflight + OneShot 등록
            var result = BuildRunner.ScheduleBuild(p, p.JobId);

            // ok=false → 에러 응답
            if (result["ok"]?.ToObject<bool>() == false)
            {
                var err = result["error"] as JObject;
                return new ErrorResponse(
                    err?["message"]?.ToString() ?? "Build scheduling failed.",
                    new
                    {
                        kind = err?["kind"]?.ToString() ?? "unknown",
                        hint = err?["hint"]?.ToString(),
                        job_id = p.JobId,
                    });
            }

            return new SuccessResponse(
                "Build scheduled",
                new
                {
                    job_id = p.JobId,
                    state = "queued",
                    progress_file = $"Library/unictl-builds/{p.JobId}.json",
                    lane = "ipc",
                    hint = $"Poll with: unictl command build_status -p job_id={p.JobId}",
                });
        }
    }
}
