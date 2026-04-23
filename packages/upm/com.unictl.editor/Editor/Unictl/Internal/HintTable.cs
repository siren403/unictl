using System.Collections.Generic;

namespace Unictl.Internal
{
    public static class HintTable
    {
        private static readonly Dictionary<string, string> _hints = new()
        {
            { "invalid_param", "unictl command build_project  # show parameter usage" },
            { "target_unsupported", "unictl command list  # see allowed target enum for build_project" },
            { "editor_busy", "wait for compile/import, or run: unictl editor status" },
            { "editor_busy_on_resume", "re-run: unictl build <same flags>; previous job is terminal" },
            { "project_locked", "stale UnityLockfile; remove it or run: unictl editor quit" },
            { "multi_instance", "multiple editors detected; quit extras before building" },
            { "editor_exit_via_hook", "hostile hook killed the editor; re-run with --batch" },
            { "lock_held", "another build is running; cancel or wait: unictl command build_status -p job_id=<id>" },
            { "ipc_no_progress_file", "IPC ack received but no progress file appeared in 3 s; check: unictl doctor" },
            { "timeout", "client wait timeout; build still running; poll: unictl command build_status -p job_id=<id>" },
            { "build_exception", "see <job_id>.log for Unity stack trace; re-run with --log-level=debug" },
            { "progress_write_degraded", "progress file writes degraded (AV/Dropbox handle lock); retrying; job continues" },
            { "define_symbols_too_large", "define_symbols exceeds 4 KiB / 128 entries; reduce or split" },
            { "not_yet_implemented", "this capability is scaffolded in P1; wire-up lands with later phases" },
        };

        public static string Get(string kind) => _hints.TryGetValue(kind, out var h) ? h : null;
    }
}
