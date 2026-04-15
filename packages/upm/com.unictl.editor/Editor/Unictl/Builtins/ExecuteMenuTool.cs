using Newtonsoft.Json.Linq;
using UnityEditor;

namespace Unictl
{
    [UnictlTool(Name = "execute_menu", Description = "Execute a Unity Editor menu item by path")]
    public static class ExecuteMenuTool
    {
        [ToolParameter("Menu item path, e.g. Assets/Create/Folder", Required = true)]
        public static string path;

        public static object HandleCommand(JObject parameters)
        {
            var p = new ToolParams(parameters);
            var (ok, menuPath, error) = p.GetRequired("path");
            if (!ok) return new ErrorResponse(error);

            var result = EditorApplication.ExecuteMenuItem(menuPath);
            if (!result)
                return new ErrorResponse($"Menu item not found or failed: {menuPath}");

            return new SuccessResponse($"Executed: {menuPath}", new { menu_path = menuPath });
        }
    }
}
