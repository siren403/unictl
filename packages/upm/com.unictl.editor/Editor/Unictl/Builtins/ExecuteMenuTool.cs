using Newtonsoft.Json.Linq;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using UnityEditor;

namespace Unictl
{
    [UnictlTool(Name = "execute_menu", Description = "Search, list, or execute a Unity Editor menu item by path. Long-running items (e.g. builds) are fired asynchronously — the response confirms the menu item exists, not that it completed.")]
    public static class ExecuteMenuTool
    {
        public class Parameters
        {
            [ToolParameter("Action: execute, search, list", Required = false, DefaultValue = "execute", Enum = "execute,search,list")]
            public string Action { get; set; }

            [ToolParameter("Menu item path, e.g. Assets/Create/Folder. Required for execute; optional parent path for list.", Required = false)]
            public string Path { get; set; }

            [ToolParameter("Case-insensitive menu search query. Used by action=search.", Required = false)]
            public string Query { get; set; }

            [ToolParameter("If true, execute synchronously and wait for completion (default: false). WARNING: long operations will block the pipe and cause CLI timeout.", Required = false)]
            public bool Sync { get; set; }

            [ToolParameter("If true, execute synchronously and call AssetDatabase.SaveAssets after the menu item succeeds. Use for menus that mutate ProjectSettings/PlayerSettings and must be visible to external tools immediately.", Required = false)]
            public bool FlushAssets { get; set; }
        }

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var action = p.Get("action", "execute").ToLowerInvariant();

            if (action == "search")
                return SearchMenus(p.Get("query") ?? p.Get("path"));

            if (action == "list")
                return ListMenus(p.Get("path", ""));

            if (action != "execute")
                return new ErrorResponse($"Unknown action: {action}", new { valid_actions = new[] { "execute", "search", "list" } });

            var (ok, menuPath, error) = p.GetRequired("path");
            if (!ok) return new ErrorResponse(error, new { valid_actions = new[] { "execute", "search", "list" } });

            var sync = p.GetBool("sync");
            var flushAssets = p.GetBool("flush_assets");

            if (sync || flushAssets)
            {
                var result = EditorApplication.ExecuteMenuItem(menuPath);
                if (!result)
                    return MenuNotFound(menuPath);
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

        private static object SearchMenus(string query)
        {
            if (string.IsNullOrWhiteSpace(query))
                return new ErrorResponse("Missing required parameter: query", new { action = "search" });

            var matches = SearchMenuPaths(query, 50);
            return new SuccessResponse($"Found {matches.Length} menu item(s) matching '{query}'", new
            {
                query,
                matches
            });
        }

        private static object ListMenus(string parentPath)
        {
            var menus = GetSubmenus(parentPath ?? "");
            return new SuccessResponse($"Listed {menus.Length} menu item(s)", new
            {
                parent_path = parentPath ?? "",
                menus
            });
        }

        private static ErrorResponse MenuNotFound(string menuPath)
        {
            var suggestions = SearchMenuPaths(LastPathSegment(menuPath), 10);
            return new ErrorResponse($"Menu item not found or failed: {menuPath}", new
            {
                menu_path = menuPath,
                suggestions,
                hint = "Run execute_menu with action=search and query=<menu text> to discover the exact Unity-version-specific path."
            });
        }

        private static string[] SearchMenuPaths(string query, int limit)
        {
            if (string.IsNullOrWhiteSpace(query)) return Array.Empty<string>();
            var needle = query.Trim();
            return GetAllMenuPaths()
                .Where(path => path.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0)
                .OrderBy(path => path.Length)
                .ThenBy(path => path, StringComparer.OrdinalIgnoreCase)
                .Take(limit)
                .ToArray();
        }

        private static string LastPathSegment(string menuPath)
        {
            if (string.IsNullOrWhiteSpace(menuPath)) return "";
            var parts = menuPath.Split('/');
            return parts.Length == 0 ? menuPath : parts[parts.Length - 1];
        }

        private static string[] GetAllMenuPaths()
        {
            var seen = new HashSet<string>();
            var pending = new Queue<string>();
            foreach (var root in GetSubmenus(""))
                pending.Enqueue(root);

            var fallbackRoots = new[] { "File", "Edit", "Assets", "GameObject", "Component", "Window", "Help" };
            foreach (var root in fallbackRoots)
                pending.Enqueue(root);

            while (pending.Count > 0 && seen.Count < 5000)
            {
                var current = pending.Dequeue();
                if (string.IsNullOrWhiteSpace(current) || !seen.Add(current))
                    continue;

                foreach (var child in GetSubmenus(current))
                {
                    if (!seen.Contains(child))
                        pending.Enqueue(child);
                }
            }

            return seen.OrderBy(path => path, StringComparer.OrdinalIgnoreCase).ToArray();
        }

        private static string[] GetSubmenus(string menuPath)
        {
            try
            {
                var unsupported = typeof(EditorApplication).Assembly.GetType("UnityEditor.Unsupported");
                var method = unsupported?.GetMethod(
                    "GetSubmenus",
                    BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic,
                    null,
                    new[] { typeof(string) },
                    null);

                if (method?.Invoke(null, new object[] { menuPath ?? "" }) is string[] submenus)
                    return submenus;
            }
            catch
            {
                // Unity does not expose a public menu enumeration API. If the
                // internal helper is unavailable on a version, return empty
                // diagnostics rather than failing execution paths.
            }

            return Array.Empty<string>();
        }
    }
}
