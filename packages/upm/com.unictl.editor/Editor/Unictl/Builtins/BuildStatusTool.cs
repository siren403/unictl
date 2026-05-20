using System;
using System.IO;
using System.Threading;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Unictl.Internal;
using UnityEngine;

namespace Unictl.Builtins
{
    [UnictlTool(
        Name = "build_status",
        Description = "Query status of a running or completed build. Pair with build_project output job_id. Reads <projectRoot>/Library/unictl-builds/<job_id>.json.")]
    public static class BuildStatusTool
    {
        public class Parameters
        {
            [ToolParameter("Job identifier returned by build_project (e.g. ci-abc123 or auto-generated UUID)", Required = false)]
            public string JobId { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var jobId = p.Get("job_id");

            // Empty-param invocation returns usage envelope
            if (string.IsNullOrEmpty(jobId))
            {
                return new SuccessResponse(
                    "Usage: unictl command build_status -p job_id=<id>",
                    new
                    {
                        kind = "usage",
                        tool = "build_status",
                        description = "Query status of a running or completed build. Reads Library/unictl-builds/<job_id>.json.",
                        quick_start = new[]
                        {
                            "unictl command build_status -p job_id=<job_id>",
                        },
                        parameters = new object[]
                        {
                            new { name = "job_id", type = "string", required = false, description = "Job identifier returned by build_project", example = "ci-abc123" },
                        },
                        companions = new[] { "build_project", "build_cancel" },
                        see_also = new[] { "unictl build --help" },
                    });
            }

            // Attempt to read the progress file from Library/unictl-builds/<job_id>.json
            var projectRoot = Application.dataPath.Replace("/Assets", "");
            var progressPath = Path.Combine(projectRoot, "Library", "unictl-builds", $"{jobId}.json");

            if (!File.Exists(progressPath))
            {
                return new ErrorResponse(
                    $"No progress file for job: {jobId}",
                    new
                    {
                        kind = "job_not_found",
                        hint = HintTable.Get("job_not_found"),
                        job_id = jobId,
                        expected_path = progressPath,
                    });
            }

            // §2.4 reader retry: 3 attempts, 200ms interval (JSON parse error 또는 IOException 시)
            const int maxAttempts = 3;
            System.Exception lastEx = null;
            for (int attempt = 0; attempt < maxAttempts; attempt++)
            {
                if (attempt > 0)
                    Thread.Sleep(200);

                try
                {
                    var content = File.ReadAllText(progressPath);
                    var json = JObject.Parse(content);
                    return new SuccessResponse($"Build status for job {jobId}", NormalizeLifecycle(json, jobId));
                }
                catch (IOException ex) { lastEx = ex; }
                catch (JsonException ex) { lastEx = ex; }
            }

            return new ErrorResponse(
                $"Failed to read progress file for job {jobId} after {maxAttempts} attempts: {lastEx?.Message}",
                new
                {
                    kind = "progress_read_failed",
                    hint = HintTable.Get("progress_read_failed"),
                    job_id = jobId,
                    path = progressPath,
                });
        }

        static JObject NormalizeLifecycle(JObject json, string fallbackJobId)
        {
            var rawState = json["state"]?.ToString() ?? "";
            var state = NormalizeState(rawState);
            var terminal = state == "succeeded" || state == "failed" || state == "cancelled";

            if (json["job_id"] == null)
                json["job_id"] = fallbackJobId;
            if (!string.IsNullOrEmpty(rawState))
                json["raw_state"] = rawState;
            json["state"] = state;
            json["terminal"] = terminal;
            json["terminal_states"] = new JArray("succeeded", "failed", "cancelled");
            json["result_source"] = json["result_source"] ?? InferResultSource(state, json);
            json["result_confidence"] = json["result_confidence"] ?? InferResultConfidence(state, json);
            if (json["warnings"] == null)
                json["warnings"] = new JArray();
            if (json["suspicion_reasons"] == null)
                json["suspicion_reasons"] = new JArray();
            if (json["suspicious"] == null)
                json["suspicious"] = false;
            if (json["recommended_action"] == null)
                json["recommended_action"] = JValue.CreateNull();

            var elapsed = ComputeElapsedMs(json["started_at"]?.ToString(), json["finished_at"]?.ToString(), terminal);
            if (elapsed.HasValue)
                json["elapsed_ms"] = elapsed.Value;

            return json;
        }

        static string NormalizeState(string rawState)
        {
            switch ((rawState ?? "").ToLowerInvariant())
            {
                case "queued":
                    return "queued";
                case "running":
                case "started":
                    return "running";
                case "done":
                case "succeeded":
                case "success":
                    return "succeeded";
                case "failed":
                case "failure":
                    return "failed";
                case "aborted":
                case "cancelled":
                case "canceled":
                    return "cancelled";
                default:
                    return "unknown";
            }
        }

        static JToken InferResultSource(string state, JObject json)
        {
            if (state == "succeeded" && json["report_summary"] != null)
                return "unity_build_report";
            if (state == "failed" && json["error"] != null)
                return "unity_build_report";
            if (state == "cancelled")
                return "build_cancel";
            if (state == "failed")
                return "progress_file";
            return JValue.CreateNull();
        }

        static JToken InferResultConfidence(string state, JObject json)
        {
            if (state == "succeeded" && json["report_summary"] != null)
                return "high";
            if (state == "failed" || state == "cancelled")
                return "high";
            return JValue.CreateNull();
        }

        static long? ComputeElapsedMs(string startedAt, string finishedAt, bool terminal)
        {
            if (string.IsNullOrEmpty(startedAt))
                return null;
            DateTime start;
            if (!DateTime.TryParse(startedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out start))
                return null;
            DateTime end;
            if (!string.IsNullOrEmpty(finishedAt))
            {
                if (!DateTime.TryParse(finishedAt, null, System.Globalization.DateTimeStyles.RoundtripKind, out end))
                    return null;
            }
            else
            {
                if (terminal)
                    return null;
                end = DateTime.UtcNow;
            }
            return Math.Max(0, (long)(end.ToUniversalTime() - start.ToUniversalTime()).TotalMilliseconds);
        }
    }
}
