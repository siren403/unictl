using Newtonsoft.Json.Linq;
using UnityEditor;

namespace Unictl
{
    [UnictlTool(Name = "execute_menu", Description = "Execute a Unity Editor menu item by path. Long-running items (e.g. builds) are fired asynchronously — the response confirms the menu item exists, not that it completed.")]
    public static class ExecuteMenuTool
    {
        public class Parameters
        {
            [ToolParameter("Menu item path, e.g. Assets/Create/Folder", Required = true)]
            public string Path { get; set; }

            [ToolParameter("If true, execute synchronously and wait for completion (default: false). WARNING: long operations will block the pipe and cause CLI timeout.", Required = false)]
            public bool Sync { get; set; }

            [ToolParameter("If true, execute synchronously and call AssetDatabase.SaveAssets after the menu item succeeds. Use for menus that mutate ProjectSettings/PlayerSettings and must be visible to external tools immediately.", Required = false)]
            public bool FlushAssets { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var (ok, menuPath, error) = p.GetRequired("path");
            if (!ok) return new ErrorResponse(error);

            var sync = p.GetBool("sync");
            var flushAssets = p.GetBool("flush_assets");

            if (sync || flushAssets)
            {
                var result = EditorApplication.ExecuteMenuItem(menuPath);
                if (!result)
                    return new ErrorResponse($"Menu item not found or failed: {menuPath}");
                if (flushAssets)
                {
                    AssetDatabase.SaveAssets();
                }
                return new SuccessResponse($"Executed (sync): {menuPath}", new
                {
                    menu_path = menuPath,
                    async = false,
                    flush_assets = flushAssets
                });
            }

            EditorApplication.delayCall += () =>
            {
                if (!EditorApplication.ExecuteMenuItem(menuPath))
                    UnityEngine.Debug.LogWarning($"[unictl] execute_menu failed: {menuPath}");
            };

            return new SuccessResponse($"Triggered: {menuPath}", new
            {
                menu_path = menuPath,
                async = true,
                hint = "Menu item will execute on the next editor frame. Use editor_control -p action=status or editor_log -p action=errors to monitor progress."
            });
        }
    }
}
