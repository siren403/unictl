using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEngine;

namespace Unictl
{
    [InitializeOnLoad]
    public static class UnictlServer
    {
        private static UnictlNative.CommandHandlerDelegate _handlerRef;
        private static HttpListener _internalListener;
        private static int _internalListenerPort = -1;

        internal static volatile bool IsPlaying;
        internal static volatile bool IsCompiling;
        internal static volatile bool IsPaused;
        internal static volatile bool RunInBackground;
        internal static string UnityVersion = "unknown";
        internal static string Platform = "unknown";
        internal static string SessionId = Guid.NewGuid().ToString();

        static UnictlServer()
        {
            if (Application.isBatchMode)
            {
                Debug.Log("[unictl] Skipping server startup in batch mode worker process.");
                return;
            }

            AssemblyReloadEvents.beforeAssemblyReload += OnBeforeReload;
            EditorApplication.quitting += OnEditorQuitting;

            RefreshCachedState();

            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
            CompilationPipeline.compilationStarted += _ => IsCompiling = true;
            CompilationPipeline.compilationFinished += _ =>
            {
                IsCompiling = false;
                RefreshCachedState();
            };

            EditorApplication.update += ProcessMainQueue;

            try
            {
                if (EditorApplication.isPlaying)
                {
                    EnsurePlayModeRuntimeDefaults("startup while already playing");
                }

                StartInternalListener();

#if UNITY_EDITOR_WIN
                var listenPath = GetPipeName();
#else
                var listenPath = GetSocketPath();
#endif
                var result = UnictlNative.unictl_start(listenPath);

                _handlerRef = OnCommand;
                UnictlNative.unictl_register_handler(_handlerRef);

                var count = UnictlNative.unictl_counter();
                Debug.Log($"[unictl] server={result}, count={count}, path={listenPath}, internal_port={_internalListenerPort}");
            }
            catch (Exception e)
            {
                StopInternalListener("startup failure");
                Debug.LogError($"[unictl] Failed to start: {e.Message}");
            }
        }

        private static void OnBeforeReload()
        {
            UnictlNative.unictl_unregister_handler();
            EditorApplication.update -= ProcessMainQueue;
            StopInternalListener("before reload");
        }

        private static void OnEditorQuitting()
        {
            StopInternalListener("editor quit");
        }

        [AOT.MonoPInvokeCallback(typeof(UnictlNative.CommandHandlerDelegate))]
        private static IntPtr OnCommand(IntPtr jsonPtr)
        {
            var json = Marshal.PtrToStringUTF8(jsonPtr) ?? "{}";

            JObject obj;
            try { obj = JObject.Parse(json); }
            catch { obj = new JObject(); }

            var command = obj["command"]?.ToString() ?? "";

            if (command == "list")
            {
                var result = ToolRouter.Execute("list", null);
                return Marshal.StringToCoTaskMemUTF8(result);
            }

            if (command == "ping")
            {
                var result = ToolRouter.Execute(command, obj["params"] as JObject);
                return Marshal.StringToCoTaskMemUTF8(result);
            }

            if (command == "editor_control")
            {
                var action = obj["params"]?["action"]?.ToString() ?? "";
                if (action == "status")
                {
                    var statusJson = JsonConvert.SerializeObject(new SuccessResponse("Editor status", new
                    {
                        is_playing = IsPlaying,
                        is_compiling = IsCompiling,
                        is_paused = IsPaused,
                        run_in_background = RunInBackground,
                        unity_version = UnityVersion,
                        platform = Platform
                    }));
                    return Marshal.StringToCoTaskMemUTF8(statusJson);
                }
            }

            return IntPtr.Zero;
        }

        internal static void ProcessMainQueue()
        {
            RefreshCachedState();

            while (true)
            {
                var ptr = UnictlNative.unictl_pop_main();
                if (ptr == IntPtr.Zero) break;

                string json;
                try { json = Marshal.PtrToStringUTF8(ptr); }
                finally { UnictlNative.unictl_free_string(ptr); }

                JObject obj;
                try { obj = JObject.Parse(json); }
                catch { continue; }

                var id = obj["id"]?.ToString() ?? "";
                var command = obj["command"]?.ToString() ?? "";
                var parameters = obj["params"] as JObject;

                string response;
                try
                {
                    response = ToolRouter.Execute(command, parameters);
                }
                catch (Exception e)
                {
                    response = JsonConvert.SerializeObject(new ErrorResponse(e.Message));
                }

                UnictlNative.unictl_respond(id, response);
            }
        }

        private static void StartInternalListener()
        {
            if (_internalListener != null)
                StopInternalListener("listener restart");

            var port = FindFreePort();
            _internalListener = new HttpListener();
            _internalListener.Prefixes.Add($"http://127.0.0.1:{port}/");
            _internalListener.Start();
            _internalListenerPort = port;
            UnictlNative.unictl_set_internal_port(port);
            Debug.Log($"[unictl] internal HttpListener on port {port}");
            BeginAccept();
        }

        private static void StopInternalListener(string reason)
        {
            if (_internalListener == null) return;

            try
            {
                Debug.Log($"[unictl] stopping internal HttpListener on port {_internalListenerPort} ({reason})");
                _internalListener.Stop();
                _internalListener.Close();
            }
            catch (Exception e)
            {
                Debug.LogWarning($"[unictl] failed to stop internal HttpListener on port {_internalListenerPort} ({reason}): {e.Message}");
            }
            finally
            {
                _internalListener = null;
                _internalListenerPort = -1;
            }
        }

        private static void BeginAccept()
        {
            try { _internalListener?.BeginGetContext(OnInternalRequest, null); }
            catch { }
        }

        private static void OnInternalRequest(IAsyncResult ar)
        {
            try
            {
                var ctx = _internalListener?.EndGetContext(ar);
                if (ctx != null)
                {
                    ctx.Response.StatusCode = 200;
                    ctx.Response.Close();
                }
            }
            catch { }

            BeginAccept();
        }

        private static void OnPlayModeStateChanged(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.EnteredPlayMode)
                EnsurePlayModeRuntimeDefaults("entered play mode");

            RefreshCachedState();
        }

        private static void EnsurePlayModeRuntimeDefaults(string reason)
        {
            if (!EditorApplication.isPlaying) return;

            if (!Application.runInBackground)
            {
                Application.runInBackground = true;
                Debug.Log($"[unictl] enabled Application.runInBackground ({reason})");
            }

            RefreshCachedState();
        }

        private static void RefreshCachedState()
        {
            IsPlaying = EditorApplication.isPlaying;
            IsCompiling = EditorApplication.isCompiling;
            IsPaused = EditorApplication.isPaused;
            RunInBackground = Application.runInBackground;
            UnityVersion = Application.unityVersion;
            Platform = Application.platform.ToString();
        }

        private static int FindFreePort()
        {
            var tmp = new TcpListener(IPAddress.Loopback, 0);
            tmp.Start();
            var port = ((IPEndPoint)tmp.LocalEndpoint).Port;
            tmp.Stop();
            return port;
        }

        private static string GetProjectRoot()
        {
            return Path.GetDirectoryName(Application.dataPath);
        }

#if UNITY_EDITOR_WIN
        private static string GetPipeName()
        {
            var projectRoot = GetProjectRoot().Replace('\\', '/');
            using var sha = System.Security.Cryptography.SHA256.Create();
            var hash = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(projectRoot));
            var shortHash = BitConverter.ToString(hash, 0, 8).Replace("-", "").ToLowerInvariant();
            return $@"\\.\pipe\unictl-{shortHash}";
        }
#else
        private static string GetSocketPath()
        {
            var unictlDir = Path.Combine(GetProjectRoot(), ".unictl");
            if (!Directory.Exists(unictlDir))
                Directory.CreateDirectory(unictlDir);

            return Path.Combine(unictlDir, "unictl.sock");
        }
#endif
    }
}
