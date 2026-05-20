using System;
using System.Collections.Generic;

namespace Unictl.Editor.Builds
{
    public sealed class UnictlBuildContext
    {
        readonly Action<UnictlBuildContextEvent> _report;

        public string JobId { get; }
        public string MethodName { get; }
        public IReadOnlyDictionary<string, string> Params { get; }
        public bool IsCancellationRequested { get; private set; }
        public bool ContextStarted { get; private set; }
        public bool ContextReported { get; private set; }
        public bool TerminalContextReported { get; private set; }

        public UnictlBuildContext(
            string jobId,
            string methodName,
            IReadOnlyDictionary<string, string> parameters,
            Action<UnictlBuildContextEvent> report)
        {
            JobId = jobId;
            MethodName = methodName;
            Params = parameters ?? new Dictionary<string, string>();
            _report = report;
        }

        public UnictlBuildScope Begin(string phase)
        {
            ContextStarted = true;
            ContextReported = true;
            _report?.Invoke(UnictlBuildContextEvent.ScopeStarted(phase));
            return new UnictlBuildScope(this, phase);
        }

        internal void Report(UnictlBuildContextEvent evt)
        {
            if (evt == null) return;
            ContextReported = true;
            if (evt.Terminal) TerminalContextReported = true;
            _report?.Invoke(evt);
        }

        public void ThrowIfCancellationRequested()
        {
            if (IsCancellationRequested)
                throw new OperationCanceledException("unictl build cancellation requested.");
        }
    }
}
