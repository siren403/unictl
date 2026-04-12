using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Unictl.Tools
{
    [UnictlTool(Name = "editor_control", Description = "Control editor state: play, stop, refresh, compile, restart, status, quit, load_scene")]
    public static class EditorControlTool
    {
        static bool _compileAfterPlayStop;

        static EditorControlTool()
        {
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
        }

        public class Parameters
        {
            [ToolParameter("Action: play, stop, refresh, compile, restart, status, quit, load_scene", Required = true)]
            public string Action { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var (ok, action, err) = p.GetRequired("action");
            if (!ok) return new ErrorResponse(err);

            switch (action)
            {
                case "play": return DoPlay();
                case "stop": return DoStop();
                case "refresh": return DoRefresh();
                case "compile": return DoCompile();
                case "restart": return DoRestart();
                case "status": return GetStatus();
                case "quit": return DoQuit();
                case "load_scene": return DoLoadScene(p);
                default:
                    return new ErrorResponse($"Unknown action: {action}");
            }
        }

        private static object DoPlay()
        {
            if (EditorApplication.isPlaying)
                return new SuccessResponse("Already in play mode", GetStateData());

            EditorApplication.isPlaying = true;
            return new SuccessResponse("Play mode requested", GetStateData());
        }

        private static object DoStop()
        {
            if (!EditorApplication.isPlaying)
                return new SuccessResponse("Already in edit mode", GetStateData());

            EditorApplication.isPlaying = false;
            return new SuccessResponse("Stop requested", GetStateData());
        }

        private static object DoCompile()
        {
            if (EditorApplication.isPlaying || EditorApplication.isPlayingOrWillChangePlaymode)
            {
                _compileAfterPlayStop = true;
                EditorApplication.isPlaying = false;
                return new SuccessResponse("Stopping play mode before compile", GetStateData());
            }

            RequestCompile();
            return new SuccessResponse("Compile requested", GetStateData());
        }

        private static object DoRefresh()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            EditorApplication.QueuePlayerLoopUpdate();
            InternalEditorUtility.RepaintAllViews();
            return new SuccessResponse("Refresh requested", GetStateData());
        }

        private static object DoRestart()
        {
            if (EditorApplication.isPlaying)
                EditorApplication.isPlaying = false;

            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            UnityEditor.Compilation.CompilationPipeline.RequestScriptCompilation();
            return new SuccessResponse("Restart requested", GetStateData());
        }

        private static object GetStatus()
        {
            return new SuccessResponse("Editor status", GetStateData());
        }

        private static object DoQuit()
        {
            EditorApplication.Exit(0);
            return new SuccessResponse("Editor quitting");
        }

        private static object DoLoadScene(ToolParams p)
        {
            var scenePath = p.Get("scene_path");
            if (string.IsNullOrWhiteSpace(scenePath))
                return new ErrorResponse("Missing required parameter: scene_path");

            if (EditorApplication.isPlaying)
                return new ErrorResponse("Cannot load a scene while already in Play mode.", GetStateData());

            for (var index = 0; index < SceneManager.sceneCount; index += 1)
            {
                var scene = SceneManager.GetSceneAt(index);
                if (scene.IsValid() && scene.isLoaded && scene.isDirty)
                {
                    return new ErrorResponse(
                        $"Cannot load scene while open scene is dirty: {scene.path}",
                        new
                        {
                            requested_scene = scenePath,
                            active_scene = SceneManager.GetActiveScene().path
                        });
                }
            }

            if (!System.IO.File.Exists(scenePath))
                return new ErrorResponse($"Scene path does not exist: {scenePath}");

            var opened = EditorSceneManager.OpenScene(scenePath, OpenSceneMode.Single);
            return new SuccessResponse("Scene loaded", new
            {
                scene_path = opened.path,
                scene_name = opened.name,
                is_loaded = opened.isLoaded,
                state = GetStateData()
            });
        }

        private static object GetStateData()
        {
            return new
            {
                is_playing = EditorApplication.isPlaying,
                is_compiling = EditorApplication.isCompiling,
                is_paused = EditorApplication.isPaused,
                run_in_background = Application.runInBackground,
                unity_version = Application.unityVersion,
                platform = Application.platform.ToString()
            };
        }

        private static void OnPlayModeStateChanged(PlayModeStateChange state)
        {
            if (!_compileAfterPlayStop)
                return;

            if (state != PlayModeStateChange.EnteredEditMode)
                return;

            _compileAfterPlayStop = false;
            RequestCompile();
        }

        private static void RequestCompile()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            UnityEditor.Compilation.CompilationPipeline.RequestScriptCompilation();
        }
    }
}
