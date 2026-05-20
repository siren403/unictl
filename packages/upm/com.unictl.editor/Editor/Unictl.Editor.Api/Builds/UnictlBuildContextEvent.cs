using System;
using UnityEditor.Build.Reporting;

namespace Unictl.Editor.Builds
{
    public sealed class UnictlBuildContextEvent
    {
        public string Kind { get; private set; }
        public string Phase { get; private set; }
        public float? Percent { get; private set; }
        public string Message { get; private set; }
        public string ErrorCode { get; private set; }
        public Exception Exception { get; private set; }
        public BuildReport Report { get; private set; }
        public string OutputPath { get; private set; }
        public bool Terminal { get; private set; }

        public static UnictlBuildContextEvent ScopeStarted(string phase) =>
            new UnictlBuildContextEvent { Kind = "scope_started", Phase = phase };

        public static UnictlBuildContextEvent Progress(string phase, float? percent, string message) =>
            new UnictlBuildContextEvent { Kind = "progress", Phase = phase, Percent = percent, Message = message };

        public static UnictlBuildContextEvent Succeeded(BuildReport report, string outputPath) =>
            new UnictlBuildContextEvent { Kind = "succeeded", Report = report, OutputPath = outputPath, Terminal = true };

        public static UnictlBuildContextEvent Failed(string code, string message, Exception exception) =>
            new UnictlBuildContextEvent { Kind = "failed", ErrorCode = code, Message = message, Exception = exception, Terminal = true };

        public static UnictlBuildContextEvent Cancelled(string reason) =>
            new UnictlBuildContextEvent { Kind = "cancelled", Message = reason, Terminal = true };

        public static UnictlBuildContextEvent ScopeDisposedWithoutTerminal(string phase) =>
            new UnictlBuildContextEvent { Kind = "scope_disposed_without_terminal", Phase = phase };
    }
}
