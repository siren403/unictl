using System;
using UnityEditor.Build.Reporting;

namespace Unictl.Editor.Builds
{
    public sealed class UnictlBuildScope : IDisposable
    {
        readonly UnictlBuildContext _context;
        readonly string _phase;
        bool _terminalReported;
        bool _disposed;

        internal UnictlBuildScope(UnictlBuildContext context, string phase)
        {
            _context = context;
            _phase = phase;
        }

        public void Progress(string phase, float? percent = null, string message = null)
        {
            _context.Report(UnictlBuildContextEvent.Progress(phase, percent, message));
        }

        public void Complete(BuildReport report)
        {
            _terminalReported = true;
            _context.Report(UnictlBuildContextEvent.Succeeded(report, null));
        }

        public void Complete(string outputPath = null)
        {
            _terminalReported = true;
            _context.Report(UnictlBuildContextEvent.Succeeded(null, outputPath));
        }

        public void Fail(string code, string message = null)
        {
            _terminalReported = true;
            _context.Report(UnictlBuildContextEvent.Failed(code, message, null));
        }

        public void Fail(Exception exception)
        {
            _terminalReported = true;
            _context.Report(UnictlBuildContextEvent.Failed("custom_build_exception", exception?.Message, exception));
        }

        public void Cancel(string reason = "cancelled")
        {
            _terminalReported = true;
            _context.Report(UnictlBuildContextEvent.Cancelled(reason));
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            if (!_terminalReported)
                _context.Report(UnictlBuildContextEvent.ScopeDisposedWithoutTerminal(_phase));
        }
    }
}
