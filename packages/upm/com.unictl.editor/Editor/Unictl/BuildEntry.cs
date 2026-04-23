using System;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using Unictl.Internal;

namespace Unictl.Editor
{
    /// <summary>
    /// Batchmode 진입점.
    /// Unity CLI: -executeMethod Unictl.Editor.BuildEntry.BuildFromCli
    /// 환경변수 UNICTL_BUILD_PARAMS_PATH 에서 파라미터 파일 경로를 읽는다.
    /// </summary>
    public static class BuildEntry
    {
        public static void BuildFromCli()
        {
            if (!Application.isBatchMode)
            {
                Debug.LogError("[unictl] BuildEntry.BuildFromCli must only be invoked via -batchmode.");
                EditorApplication.Exit(2);
                return;
            }

            var paramsPath = Environment.GetEnvironmentVariable("UNICTL_BUILD_PARAMS_PATH");
            if (string.IsNullOrEmpty(paramsPath) || !File.Exists(paramsPath))
            {
                Debug.LogError($"[unictl] UNICTL_BUILD_PARAMS_PATH not set or not found: {paramsPath}");
                EditorApplication.Exit(2);
                return;
            }

            BuildParams p;
            try
            {
                var json = File.ReadAllText(paramsPath);
                var jobj = JObject.Parse(json);
                p = BuildParams.FromJObject(jobj);
            }
            catch (Exception ex)
            {
                Debug.LogError($"[unictl] Failed to parse build params: {ex.Message}");
                EditorApplication.Exit(2);
                return;
            }

            if (string.IsNullOrEmpty(p.JobId))
                p.JobId = Guid.NewGuid().ToString("N");

            // ScheduleBuild → OneShot으로 다음 틱에 빌드 실행 → Exit(code)
            var result = BuildRunner.ScheduleBuild(p, p.JobId);
            Debug.Log($"[unictl] BuildEntry scheduled: {result}");
            // 이 메서드는 즉시 return — Unity editor loop이 계속 돌면서 OneShot 발화 후 Exit
        }
    }
}
