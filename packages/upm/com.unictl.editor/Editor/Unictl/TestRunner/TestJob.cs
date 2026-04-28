using System;

namespace Unictl.TestRunner
{
    [Serializable]
    public class TestJob
    {
        // Meta
        public int    schema_version    = 1;
        public string job_id;
        public string editor_session_id;
        public int    editor_pid;

        // Input
        public string platform;          // editmode|playmode
        public string assembly;
        public string test_filter;
        public string results_path;
        public long   deadline_ms;       // 0 = unlimited

        // State
        public string state;             // queued|running|finished|failed
        public string terminal_reason;   // null|completed|timed_out|reload_during_run|xml_save_failed|cancelled
        public string error_kind;
        public string error_message;
        public int    attempt;

        // Timing
        public long   started_at_ms;
        public long   run_started_at_ms;
        public long   run_finished_at_ms;
        public long   last_update_ms;

        // Results
        public int total;
        public int passed;
        public int failed;
        public int skipped;
        public int inconclusive;
    }
}
