using System;
using Unictl.Editor.Builds;

namespace UnictlSmokeProject.Editor
{
    public static class UnictlCustomBuildSmoke
    {
        public static void NoContext()
        {
        }

        public static void ContextNoBegin(UnictlBuildContext ctx)
        {
            var _ = ctx.JobId;
        }

        public static void ContextComplete(UnictlBuildContext ctx)
        {
            using var build = ctx.Begin("smoke_complete");
            build.Progress("writing_marker", 0.5f, "Writing smoke build marker.");
            build.Complete("Build/Smoke/custom-build-smoke.txt");
        }

        public static void Throws()
        {
            throw new InvalidOperationException("custom build smoke exception");
        }
    }
}
