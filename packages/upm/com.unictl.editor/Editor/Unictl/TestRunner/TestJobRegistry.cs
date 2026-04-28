namespace Unictl.TestRunner
{
    public static class TestJobRegistry
    {
        private static volatile TestJob _active;

        public static bool HasActiveJob =>
            _active != null &&
            (_active.state == "queued" || _active.state == "running");

        public static string ActiveJobId => _active?.job_id;

        public static void Register(TestJob job)
        {
            _active = job;
        }

        public static void Clear()
        {
            _active = null;
        }
    }
}
