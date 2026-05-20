using Newtonsoft.Json.Linq;
using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.SceneManagement;
using Unictl.TestRunner;
using Unictl;

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
            [ToolParameter("Action: play, stop, refresh, compile, restart, status, quit, load_scene", Required = true, Enum = "play,stop,refresh,compile,restart,status,quit,load_scene")]
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
                case "restart": return DoRestart(p);
                case "status": return GetStatus();
                case "quit": return DoQuit(p);
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
                var deferredRequest = UnictlHeartbeat.RecordCompileRequest(
                    "editor_control.compile",
                    refreshRequested: false,
                    scriptCompilationRequested: false);
                deferredRequest["deferred_until_edit_mode"] = true;
                _compileAfterPlayStop = true;
                EditorApplication.isPlaying = false;
                return new SuccessResponse("Stopping play mode before compile", GetStateData(deferredRequest));
            }

            var request = UnictlHeartbeat.RecordCompileRequest(
                "editor_control.compile",
                refreshRequested: true,
                scriptCompilationRequested: true);
            RequestCompile();
            return new SuccessResponse("Compile requested", GetStateData(request));
        }

        private static object DoRefresh()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            EditorApplication.QueuePlayerLoopUpdate();
            InternalEditorUtility.RepaintAllViews();
            return new SuccessResponse("Refresh requested", GetStateData());
        }

        private static object DoRestart(ToolParams p)
        {
            AuditEditorControl("restart", p);

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

        private static object DoQuit(ToolParams p)
        {
            AuditEditorControl("quit", p);
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

        private static object GetStateData(JObject compileRequest = null)
        {
            return new
            {
                is_playing = EditorApplication.isPlaying,
                is_compiling = EditorApplication.isCompiling,
                is_paused = EditorApplication.isPaused,
                domain_reload = TestPreflight.GetDomainReloadStatus(),
                run_in_background = Application.runInBackground,
                unity_version = Application.unityVersion,
                platform = Application.platform.ToString(),
                compile_lifecycle = UnictlHeartbeat.CompileLifecycleSnapshot(),
                compile_request = compileRequest
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

        private static void AuditEditorControl(string action, ToolParams p)
        {
            var meta = p.GetRaw("_meta") as JObject;
            var audit = new JObject
            {
                ["schema_version"] = 1,
                ["at"] = DateTime.UtcNow.ToString("o"),
                ["tool"] = "editor_control",
                ["action"] = action,
                ["editor_pid"] = System.Diagnostics.Process.GetCurrentProcess().Id,
                ["editor_session_id"] = UnictlServer.SessionId,
                ["project_root"] = GetProjectRoot(),
                ["client_pid"] = meta?["client_pid"],
                ["transport"] = meta?["transport"],
                ["transport_id"] = meta?["transport_id"],
                ["request_id"] = meta?["request_id"],
                ["sent_at"] = meta?["sent_at"],
                ["cwd"] = meta?["cwd"],
                ["cli_args"] = meta?["cli_args"] ?? new JArray()
            };

            var line = audit.ToString(Newtonsoft.Json.Formatting.None);
            Debug.Log($"[Unictl][editor_control] audit {line}");
            AppendAuditLine(line);
        }

        private static void AppendAuditLine(string line)
        {
            try
            {
                var path = GetAuditLogPath();
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                File.AppendAllText(path, line + Environment.NewLine);
                TrimAuditLog(path, 200);
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[Unictl][editor_control] failed to write audit log: {e.Message}");
            }
        }

        private static void TrimAuditLog(string path, int maxLines)
        {
            var lines = File.ReadAllLines(path);
            if (lines.Length <= maxLines) return;
            File.WriteAllLines(path, lines.Skip(lines.Length - maxLines).ToArray());
        }

        private static string GetAuditLogPath()
        {
            return Path.Combine(GetProjectRoot(), "Library", "unictl-state", "editor-control.log");
        }

        private static string GetProjectRoot()
        {
            return Path.GetDirectoryName(Application.dataPath);
        }
    }
}
