using System.Collections.Generic;

namespace Unictl.Internal
{
    public static class HintTable
    {
        private static readonly Dictionary<string, string> _hints = new()
        {
            { "invalid_param",          "unictl command build_project  # show parameter usage" },
            { "target_unsupported",     "unictl command list  # see allowed target enum for build_project" },
            { "editor_busy",            "wait for compile/import, or run: unictl editor status" },
            { "project_locked",         "stale UnityLockfile; remove it or run: unictl editor quit" },
            { "multi_instance",         "multiple editors detected; quit extras before building" },
            { "lock_held",              "another build is running; cancel or wait: unictl command build_status -p job_id=<id>" },
            { "ipc_no_progress_file",   "IPC ack received but no progress file appeared in 3 s; check: unictl doctor" },
            { "timeout",                "client wait timeout; build still running; poll: unictl command build_status -p job_id=<id>" },
            { "build_exception",        "see <job_id>.log for Unity stack trace; re-run with --log-level=debug" },
            { "not_yet_implemented",    "this capability is scaffolded in P1; wire-up lands with later phases" },
            { "build_failed",           "see progress_file report_summary for error details; check Unity log" },
            { "editor_running",         "editor is running; quit it first or omit --batch to use IPC lane" },
            { "editor_not_running",     "editor is not running; open it first with: unictl editor open" },
            { "cancelled_by_user",      "Job aborted by user via build_cancel. Re-run the build if needed." },
            { "not_cancellable",        "Job is past queue stage. BuildPipeline.BuildPlayer has no interrupt API; wait for completion." },
            { "profile_switch_requires_batch", "IPC lane cannot cross a domain reload. Quit editor and re-run with --batch to apply a BuildProfile." },
            { "profile_not_found",      "BuildProfile asset not found at the given path. Verify path relative to project root." },
            { "profile_invalid_extension", "BuildProfile path must end with .asset. Pass an asset path, not a directory or label." },
            { "profile_invalid_path",   "BuildProfile path must resolve inside the project root." },
            { "profile_unsupported_on_this_unity", "BuildProfile requires Unity 6000.0+. Remove --build-profile or upgrade editor." },
        };

        public static string Get(string kind) => _hints.TryGetValue(kind, out var h) ? h : null;
    }
}
