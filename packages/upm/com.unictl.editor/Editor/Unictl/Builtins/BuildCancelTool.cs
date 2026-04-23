using Newtonsoft.Json.Linq;
using Unictl.Internal;

namespace Unictl.Builtins
{
    [UnictlTool(
        Name = "build_cancel",
        Description = "Request cancellation of a running build (cooperative; Unity BuildPipeline has no interrupt once executing).")]
    public static class BuildCancelTool
    {
        public class Parameters
        {
            [ToolParameter("Job identifier to cancel (returned by build_project)", Required = true)]
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
                    "Usage: unictl command build_cancel -p job_id=<id>",
                    new
                    {
                        kind = "usage",
                        tool = "build_cancel",
                        description = "Request cooperative cancellation of a running build. Note: once BuildPipeline.BuildPlayer is executing, Unity provides no interrupt API; cancellation only takes effect at safe points before execution.",
                        quick_start = new[]
                        {
                            "unictl command build_cancel -p job_id=<job_id>",
                        },
                        parameters = new object[]
                        {
                            new { name = "job_id", type = "string", required = true, description = "Job identifier to cancel (returned by build_project)", example = "ci-abc123" },
                        },
                        companions = new[] { "build_project", "build_status" },
                        see_also = new[] { "unictl build --help" },
                    });
            }

            // Cancellation not yet implemented (lands in P3)
            return new ErrorResponse(
                "build_cancel is scaffolded in P1; cooperative cancellation lands in P3.",
                new
                {
                    kind = "not_yet_implemented",
                    hint = HintTable.Get("not_yet_implemented"),
                    job_id = jobId,
                    phase_needed = "P3",
                });
        }
    }
}
