using System;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace Unictl.TestRunner
{
    public class TestCallbacks : ICallbacks
    {
        private readonly string _jobId;

        public TestCallbacks(string jobId)
        {
            _jobId = jobId;
        }

        public void RunStarted(ITestAdaptor testsToRun)
        {
            var job = TestProgressFile.Read(_jobId);
            if (job == null) return;

            job.state = "running";
            job.run_started_at_ms = NowMs();
            job.last_update_ms = NowMs();
            TestProgressFile.Write(job);
        }

        public void RunFinished(ITestResultAdaptor result)
        {
            var job = TestProgressFile.Read(_jobId);
            if (job == null) return;

            try
            {
                TestRunnerApi.SaveResultToFile(result, job.results_path);
            }
            catch (Exception e)
            {
                job.state = "failed";
                job.terminal_reason = "xml_save_failed";
                job.error_kind = "xml_save_failed";
                job.error_message = e.Message;
                job.run_finished_at_ms = NowMs();
                job.last_update_ms = NowMs();
                TestProgressFile.Write(job);
                TestJobRegistry.Clear();
                TestHeartbeat.Stop(_jobId);
                Debug.LogError($"[unictl][TestCallbacks] Failed to save XML results: {e.Message}");
                return;
            }

            job.total        = result.PassCount + result.FailCount + result.SkipCount + result.InconclusiveCount;
            job.passed       = result.PassCount;
            job.failed       = result.FailCount;
            job.skipped      = result.SkipCount;
            job.inconclusive = result.InconclusiveCount;
            job.state        = "finished";
            job.terminal_reason = "completed";
            job.run_finished_at_ms = NowMs();
            job.last_update_ms = NowMs();

            TestProgressFile.Write(job);
            TestJobRegistry.Clear();
            TestHeartbeat.Stop(_jobId);

            Debug.Log($"[unictl][TestCallbacks] Run finished. " +
                      $"Passed={job.passed}, Failed={job.failed}, " +
                      $"Skipped={job.skipped}, Inconclusive={job.inconclusive}");
        }

        public void TestStarted(ITestAdaptor test)
        {
            TestHeartbeat.Touch();
        }

        public void TestFinished(ITestResultAdaptor result)
        {
            TestHeartbeat.Touch();
        }

        private static long NowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }
}
