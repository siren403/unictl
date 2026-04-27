using System;
using System.IO;
using UnityEditor;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace Unictl
{
    /// <summary>
    /// Batchmode 진입점 — -executeMethod 방식으로 NUnit XML을 신뢰성 있게 생성한다.
    /// Unity CLI: -executeMethod Unictl.BatchTestRunner.RunFromCommandLine
    /// </summary>
    public static class BatchTestRunner
    {
        private const string ResultsArg  = "-unictlTestResults";
        private const string PlatformArg = "-unictlTestPlatform";
        private const string AssemblyArg = "-unictlTestAssembly";
        private const string FilterArg   = "-unictlTestFilter";

        public static void RunFromCommandLine()
        {
            if (!Application.isBatchMode)
            {
                Debug.LogError("[unictl] BatchTestRunner.RunFromCommandLine must only be invoked via -batchmode.");
                EditorApplication.Exit(2);
                return;
            }

            var args = Environment.GetCommandLineArgs();
            var options = Options.FromCommandLine(args);

            if (string.IsNullOrWhiteSpace(options.ResultsPath))
            {
                Debug.LogError($"[unictl] {ResultsArg} is required.");
                EditorApplication.Exit(2);
                return;
            }

            Debug.Log($"[unictl][BatchTestRunner] Starting tests: {options}");

            var api = ScriptableObject.CreateInstance<TestRunnerApi>();
            api.RegisterCallbacks(new Callbacks(options));

            var filter = new Filter
            {
                testMode      = options.Platform,
                assemblyNames = options.AssemblyNames,
                testNames     = options.FilterNames,
            };

            var settings = new ExecutionSettings(filter)
            {
                runSynchronously = true,
            };

            api.Execute(settings);
        }

        // -----------------------------------------------------------------------
        // Callbacks
        // -----------------------------------------------------------------------

        private sealed class Callbacks : ICallbacks
        {
            private readonly Options options;

            public Callbacks(Options options)
            {
                this.options = options;
            }

            public void RunStarted(ITestAdaptor testsToRun)
            {
                Debug.Log($"[unictl][BatchTestRunner] Run started. Root={testsToRun.FullName}, Cases={testsToRun.TestCaseCount}");
            }

            public void RunFinished(ITestResultAdaptor result)
            {
                Debug.Log(
                    $"[unictl][BatchTestRunner] Run finished. Status={result.TestStatus}, " +
                    $"Passed={result.PassCount}, Failed={result.FailCount}, " +
                    $"Skipped={result.SkipCount}, Inconclusive={result.InconclusiveCount}");

                if (!string.IsNullOrWhiteSpace(options.ResultsPath))
                {
                    EnsureParentDirectory(options.ResultsPath);
                    TestRunnerApi.SaveResultToFile(result, options.ResultsPath);
                    Debug.Log($"[unictl][BatchTestRunner] Saved NUnit XML to: {options.ResultsPath}");
                }

                int exitCode = (result.FailCount > 0 || result.InconclusiveCount > 0 || result.TestStatus == TestStatus.Failed)
                    ? 1
                    : 0;

                EditorApplication.Exit(exitCode);
            }

            public void TestStarted(ITestAdaptor test)
            {
                if (!test.IsSuite)
                {
                    Debug.Log($"[unictl][BatchTestRunner] Test started: {test.FullName}");
                }
            }

            public void TestFinished(ITestResultAdaptor result)
            {
                if (!result.Test.IsSuite)
                {
                    Debug.Log($"[unictl][BatchTestRunner] Test finished: {result.FullName} => {result.TestStatus}");
                }
            }

            private static void EnsureParentDirectory(string filePath)
            {
                string dir = Path.GetDirectoryName(filePath);
                if (!string.IsNullOrWhiteSpace(dir))
                {
                    Directory.CreateDirectory(dir);
                }
            }
        }

        // -----------------------------------------------------------------------
        // Options
        // -----------------------------------------------------------------------

        private sealed class Options
        {
            public string      ResultsPath   { get; private set; }
            public TestMode    Platform      { get; private set; }
            public string[]    AssemblyNames { get; private set; }
            public string[]    FilterNames   { get; private set; }

            public static Options FromCommandLine(string[] args)
            {
                var platformRaw = GetValue(args, PlatformArg) ?? "editmode";
                var platform    = string.Equals(platformRaw, "playmode", StringComparison.OrdinalIgnoreCase)
                    ? TestMode.PlayMode
                    : TestMode.EditMode;

                return new Options
                {
                    ResultsPath   = GetValue(args, ResultsArg),
                    Platform      = platform,
                    AssemblyNames = SplitOrNull(GetValue(args, AssemblyArg)),
                    FilterNames   = SplitOrNull(GetValue(args, FilterArg)),
                };
            }

            public override string ToString()
            {
                return $"results={ResultsPath ?? "<none>"}, platform={Platform}, " +
                       $"assemblies={JoinOrNone(AssemblyNames)}, filters={JoinOrNone(FilterNames)}";
            }

            private static string GetValue(string[] args, string key)
            {
                for (int i = 0; i < args.Length - 1; i++)
                {
                    if (string.Equals(args[i], key, StringComparison.OrdinalIgnoreCase))
                    {
                        return args[i + 1];
                    }
                }

                return null;
            }

            private static string[] SplitOrNull(string raw)
            {
                if (string.IsNullOrWhiteSpace(raw))
                    return null;

                var parts = raw.Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries);
                for (int i = 0; i < parts.Length; i++)
                {
                    parts[i] = parts[i].Trim();
                }

                return parts;
            }

            private static string JoinOrNone(string[] values)
            {
                return values == null || values.Length == 0 ? "<none>" : string.Join(";", values);
            }
        }
    }
}
