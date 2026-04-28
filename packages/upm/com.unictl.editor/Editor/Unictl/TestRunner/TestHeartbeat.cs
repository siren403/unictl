using System;
using UnityEditor;
using UnityEngine;

namespace Unictl.TestRunner
{
    public static class TestHeartbeat
    {
        private static string _activeJobId;
        private static double _lastTickTime;

        public static void Start(string jobId)
        {
            _activeJobId = jobId;
            _lastTickTime = EditorApplication.timeSinceStartup;
            EditorApplication.update += Tick;
            Debug.Log($"[unictl][TestHeartbeat] Started for job {jobId}");
        }

        public static void Stop(string jobId)
        {
            if (_activeJobId != jobId) return;
            EditorApplication.update -= Tick;
            _activeJobId = null;
            Debug.Log($"[unictl][TestHeartbeat] Stopped for job {jobId}");
        }

        public static void Touch()
        {
            _lastTickTime = EditorApplication.timeSinceStartup;
        }

        private static void Tick()
        {
            if (string.IsNullOrEmpty(_activeJobId)) return;
            if (EditorApplication.timeSinceStartup - _lastTickTime < 1.0) return;
            _lastTickTime = EditorApplication.timeSinceStartup;

            var job = TestProgressFile.Read(_activeJobId);
            if (job == null)
            {
                var staleId = _activeJobId;
                EditorApplication.update -= Tick;
                _activeJobId = null;
                Debug.LogWarning($"[unictl][TestHeartbeat] Progress file missing for job {staleId}; stopping heartbeat.");
                return;
            }

            if (job.deadline_ms > 0 && NowMs() > job.deadline_ms)
            {
                job.state = "failed";
                job.terminal_reason = "timed_out";
                job.error_kind = "test_timeout";
                job.error_message = "Wall-clock deadline exceeded";
                job.run_finished_at_ms = NowMs();
                job.last_update_ms = NowMs();
                TestProgressFile.Write(job);
                TestJobRegistry.Clear();
                EditorApplication.update -= Tick;
                _activeJobId = null;
                Debug.LogWarning($"[unictl][TestHeartbeat] Deadline exceeded for job {job.job_id}; marked timed_out.");
                return;
            }

            job.last_update_ms = NowMs();
            TestProgressFile.Write(job);
        }

        private static long NowMs()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }
    }
}
