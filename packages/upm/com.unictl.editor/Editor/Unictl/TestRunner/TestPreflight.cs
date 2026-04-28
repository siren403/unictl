using System;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine.SceneManagement;

namespace Unictl.TestRunner
{
    public class PreflightResult
    {
        public string ErrorKind;
        public string Message;
        public bool HasError => !string.IsNullOrEmpty(ErrorKind);
    }

    public class TestRunRequest
    {
        public int    schema_version;
        public string platform;
        public string assembly;
        public string test_filter;
        public string results_path;
        public string job_id;
        public long   timeout_deadline_ms;
        public bool   allow_unsaved_scenes;
        public bool   allow_reload_active;

        public bool IsValid { get; set; } = true;
        public string ValidationError { get; set; }
    }

    public static class TestPreflight
    {
        public static PreflightResult Check(TestRunRequest req)
        {
            if (EditorApplication.isCompiling)
                return Reject("editor_busy_compiling", "Editor is compiling scripts.");

            if (EditorApplication.isUpdating)
                return Reject("editor_busy_updating", "Editor is processing asset import.");

            if (!IsResultsPathWritable(req.results_path))
                return Reject("results_path_unwritable", $"Cannot write to results path: {req.results_path}");

            if (req.platform == "playmode")
            {
                if (EditorApplication.isPlayingOrWillChangePlaymode)
                    return Reject("editor_busy_playing", "Editor is in or transitioning to Play mode.");

                if (!req.allow_reload_active && IsFullReloadActive())
                    return Reject("editor_reload_active",
                        "PlayMode tests with full domain reload are not supported in editor lane. Use --batch or set DisableDomainReload.");

                if (!req.allow_unsaved_scenes && AnySceneDirty())
                    return Reject("editor_dirty_scene", "One or more open scenes have unsaved changes.");

                if (PrefabStageDirty())
                    return Reject("editor_dirty_prefab_stage", "Prefab stage has unsaved changes.");
            }

            return new PreflightResult();
        }

        private static bool IsFullReloadActive()
        {
            if (!EditorSettings.enterPlayModeOptionsEnabled) return true;
            return (EditorSettings.enterPlayModeOptions & EnterPlayModeOptions.DisableDomainReload) == 0;
        }

        private static bool AnySceneDirty()
        {
            for (int i = 0; i < SceneManager.sceneCount; i++)
            {
                if (SceneManager.GetSceneAt(i).isDirty)
                    return true;
            }
            return false;
        }

        private static bool PrefabStageDirty()
        {
            var stage = PrefabStageUtility.GetCurrentPrefabStage();
            return stage != null && stage.scene.isDirty;
        }

        private static bool IsResultsPathWritable(string path)
        {
            try
            {
                var dir = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                    Directory.CreateDirectory(dir);
                var probe = Path.Combine(
                    string.IsNullOrEmpty(dir) ? "." : dir,
                    $".unictl-write-probe-{Guid.NewGuid()}.tmp");
                File.WriteAllText(probe, "probe");
                File.Delete(probe);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static PreflightResult Reject(string kind, string message)
        {
            return new PreflightResult { ErrorKind = kind, Message = message };
        }
    }
}
