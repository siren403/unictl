using Unictl;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;
using System.IO;

[UnictlTool(Name = "capture_ui", Description = "Capture game view screenshot including UI Toolkit overlay. Requires Play mode.")]
public static class CaptureUI
{
    public class Parameters
    {
        [ToolParameter("Output file path, absolute or relative to project root", Required = false)]
        public string OutputPath { get; set; }
    }

    public static object HandleCommand(JObject parameters)
    {
        if (!EditorApplication.isPlaying)
            return new ErrorResponse("Play mode required.");

        var p = new ToolParams(parameters ?? new JObject());
        var projectPath = Path.GetDirectoryName(Application.dataPath);
        var outputPath = p.Get("output_path", Path.Combine(projectPath, ".screenshots", "capture.png"));

        if (!Path.IsPathRooted(outputPath))
            outputPath = Path.Combine(projectPath, outputPath);

        var dir = Path.GetDirectoryName(outputPath);
        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            Directory.CreateDirectory(dir);

        var capturePath = outputPath;
        if (capturePath.StartsWith(projectPath))
            capturePath = Path.GetRelativePath(projectPath, capturePath);

        Debug.Log($"[CaptureUI] Requested {outputPath}");
        Debug.Log($"[CaptureUI] Dispatching CaptureScreenshot with path {capturePath}");
        ScreenCapture.CaptureScreenshot(capturePath);
        EditorApplication.QueuePlayerLoopUpdate();
        InternalEditorUtility.RepaintAllViews();
        return new SuccessResponse("Screenshot capture started.", new { path = outputPath });
    }
}
