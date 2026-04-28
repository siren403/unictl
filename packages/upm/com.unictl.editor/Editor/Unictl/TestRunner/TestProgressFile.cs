using System;
using System.IO;
using Newtonsoft.Json;
using UnityEngine;

namespace Unictl.TestRunner
{
    public static class TestProgressFile
    {
        private const string ProgressDir = "Library/unictl-tests";

        private static string GetFullPath(string jobId)
        {
            return Path.Combine(Application.dataPath, "..", ProgressDir, $"{jobId}.json");
        }

        public static string RelativePath(string jobId)
        {
            return $"{ProgressDir}/{jobId}.json";
        }

        public static void Write(TestJob job)
        {
            var fullPath = GetFullPath(job.job_id);
            var dir = Path.GetDirectoryName(fullPath);
            if (!Directory.Exists(dir))
                Directory.CreateDirectory(dir);

            var json = JsonConvert.SerializeObject(job, Formatting.Indented);
            var tmpPath = fullPath + ".tmp";
            File.WriteAllText(tmpPath, json, System.Text.Encoding.UTF8);
            if (File.Exists(fullPath))
                File.Delete(fullPath);
            File.Move(tmpPath, fullPath);
        }

        public static TestJob Read(string jobId)
        {
            var fullPath = GetFullPath(jobId);
            if (!File.Exists(fullPath))
                return null;

            try
            {
                var json = File.ReadAllText(fullPath, System.Text.Encoding.UTF8);
                return JsonConvert.DeserializeObject<TestJob>(json);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[unictl][TestProgressFile] Failed to read {fullPath}: {e.Message}");
                return null;
            }
        }
    }
}
