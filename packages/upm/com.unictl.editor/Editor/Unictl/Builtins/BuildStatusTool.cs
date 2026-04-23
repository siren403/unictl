using System.IO;
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
                    $"job not found: {jobId}",
                    new
                    {
                        kind = "invalid_param",
                        hint = HintTable.Get("invalid_param"),
                        job_id = jobId,
                        expected_path = progressPath,
                    });
            }

            try
            {
                var content = File.ReadAllText(progressPath);
                var json = JObject.Parse(content);
                return new SuccessResponse($"Build status for job {jobId}", json);
            }
            catch (JsonException ex)
            {
                return new ErrorResponse(
                    $"Failed to parse progress file for job {jobId}: {ex.Message}",
                    new
                    {
                        kind = "invalid_param",
                        hint = HintTable.Get("invalid_param"),
                        job_id = jobId,
                        path = progressPath,
                    });
            }
        }
    }
}
