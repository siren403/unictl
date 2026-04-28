using System;
using System.Diagnostics;
using Newtonsoft.Json.Linq;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace Unictl.TestRunner
{
    [UnictlTool(
        Name = "test_run",
        Description = "Run Unity tests via TestRunnerApi (editor lane). Returns {ok,job_id,state:'queued'} immediately. Poll Library/unictl-tests/<job-id>.json for progress.")]
    public static class TestRunnerTool
    {
        public class Parameters
        {
            [ToolParameter("Test platform: editmode or playmode", Required = true, Enum = "editmode,playmode")]
            public string Platform { get; set; }

            [ToolParameter("Assembly name to filter tests (e.g. UnictlPoc)", Required = false)]
            public string Assembly { get; set; }

            [ToolParameter("Full test name filter (e.g. MyNamespace.MyClass.MyMethod)", Required = false)]
            public string TestFilter { get; set; }

            [ToolParameter("Path for NUnit XML results output", Required = true)]
            public string ResultsPath { get; set; }

            [ToolParameter("Client-provided job identifier (UUID v4 recommended)", Required = true)]
            public string JobId { get; set; }

            [ToolParameter("Wall-clock deadline as Unix epoch ms; 0 = unlimited", Required = false, DefaultValue = "0")]
            public string TimeoutDeadlineMs { get; set; }

            [ToolParameter("Allow test run even if scenes have unsaved changes (playmode only)", Required = false, DefaultValue = "false")]
            public string AllowUnsavedScenes { get; set; }

            [ToolParameter("Allow playmode test run even if full domain reload is active (dangerous — may hang)", Required = false, DefaultValue = "false")]
            public string AllowReloadActive { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);

            // Parse and validate request
            var req = ParseRequest(p);
            if (!req.IsValid)
                return ErrorResult("invalid_param", req.ValidationError,
                    "unictl command test_run -p platform=editmode -p results_path=<path> -p job_id=<uuid>");

            // Single active job guard
            if (TestJobRegistry.HasActiveJob)
                return ErrorResult("test_already_running",
                    $"Job {TestJobRegistry.ActiveJobId} is already running. Wait for completion or cancel.",
                    null);

            // Preflight checks
            var preflight = TestPreflight.Check(req);
            if (preflight.HasError)
                return ErrorResult(preflight.ErrorKind, preflight.Message, BuildPreflightHint(preflight.ErrorKind));

            // Build job
            var job = new TestJob
            {
                schema_version    = 1,
                job_id            = req.job_id,
                platform          = req.platform,
                assembly          = req.assembly,
                test_filter       = req.test_filter,
                results_path      = req.results_path,
                deadline_ms       = req.timeout_deadline_ms,
                started_at_ms     = NowMs(),
                last_update_ms    = NowMs(),
                editor_session_id = UnictlServer.SessionId,
                editor_pid        = Process.GetCurrentProcess().Id,
                state             = "queued",
                attempt           = 1,
            };

            TestJobRegistry.Register(job);
            TestProgressFile.Write(job);

            // Execute async
            var api = ScriptableObject.CreateInstance<TestRunnerApi>();
            api.RegisterCallbacks(new TestCallbacks(job.job_id));

            var filter = new Filter
            {
                testMode     = req.platform == "playmode" ? TestMode.PlayMode : TestMode.EditMode,
                assemblyNames = !string.IsNullOrEmpty(req.assembly) ? new[] { req.assembly } : null,
                testNames    = !string.IsNullOrEmpty(req.test_filter) ? new[] { req.test_filter } : null,
            };

            api.Execute(new ExecutionSettings(filter));

            TestHeartbeat.Start(job.job_id);

            Debug.Log($"[unictl][TestRunnerTool] Queued job {job.job_id} platform={job.platform}");

            return new
            {
                ok                = true,
                job_id            = job.job_id,
                state             = "queued",
                progress_file     = TestProgressFile.RelativePath(job.job_id),
                editor_session_id = job.editor_session_id,
                editor_pid        = job.editor_pid,
            };
        }

        private static TestRunRequest ParseRequest(ToolParams p)
        {
            var req = new TestRunRequest();

            var platform = p.Get("platform", "editmode").ToLowerInvariant();
            if (platform != "editmode" && platform != "playmode")
            {
                req.IsValid = false;
                req.ValidationError = "platform must be 'editmode' or 'playmode'";
                return req;
            }
            req.platform = platform;

            var (hasResults, resultsPath, resultsErr) = p.GetRequired("results_path");
            if (!hasResults)
            {
                req.IsValid = false;
                req.ValidationError = resultsErr;
                return req;
            }
            req.results_path = resultsPath;

            var (hasJobId, jobId, jobErr) = p.GetRequired("job_id");
            if (!hasJobId)
            {
                req.IsValid = false;
                req.ValidationError = jobErr;
                return req;
            }
            req.job_id = jobId;

            req.assembly          = p.Get("assembly");
            req.test_filter       = p.Get("test_filter");
            req.allow_unsaved_scenes = p.GetBool("allow_unsaved_scenes", false);
            req.allow_reload_active  = p.GetBool("allow_reload_active", false);

            var deadlineRaw = p.Get("timeout_deadline_ms", "0");
            req.timeout_deadline_ms = long.TryParse(deadlineRaw, out var dl) ? dl : 0L;

            req.IsValid = true;
            return req;
        }

        private static object ErrorResult(string kind, string message, string hintCommand)
        {
            return new
            {
                ok    = false,
                error = new
                {
                    kind,
                    message,
                    hint_command = hintCommand,
                }
            };
        }

        private static string BuildPreflightHint(string errorKind)
        {
            switch (errorKind)
            {
                case "editor_reload_active":
                    return "unictl test --batch --platform playmode --results <path>";
                case "editor_busy_compiling":
                case "editor_busy_updating":
                    return "unictl editor status";
                case "editor_busy_playing":
                    return "Stop Play mode before running tests.";
                default:
                    return null;
            }
        }

        private static long NowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }
}
