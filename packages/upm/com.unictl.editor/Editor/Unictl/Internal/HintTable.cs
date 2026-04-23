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
        };

        public static string Get(string kind) => _hints.TryGetValue(kind, out var h) ? h : null;
    }
}
