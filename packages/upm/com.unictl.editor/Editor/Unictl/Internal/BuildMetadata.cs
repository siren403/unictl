using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace Unictl.Internal
{
    /// <summary>
    /// Phase 2b — Build Metadata: 빌드 산출물 메타데이터 계산.
    /// terminal state의 report_summary에 추가 필드를 제공한다.
    /// </summary>
    internal static class BuildMetadata
    {
        // output_kind 열거
        internal enum OutputKind { File, Directory, Project }

        /// <summary>
        /// 빌드 성공 후 outputPath + target 기반으로 메타데이터를 계산해 JObject로 반환.
        /// outputPath가 존재하지 않으면 null 반환 (빌드 실패 케이스 방어).
        /// </summary>
        internal static JObject Compute(string outputPath, BuildTarget target)
        {
            // outputPath 미존재 — 빌드 실패 후 경로가 만들어지지 않은 경우
            if (string.IsNullOrEmpty(outputPath) ||
                (!File.Exists(outputPath) && !Directory.Exists(outputPath)))
            {
                return null;
            }

            var kind = DetermineOutputKind(outputPath, target);
            var kindStr = kind == OutputKind.File ? "file"
                        : kind == OutputKind.Project ? "project"
                        : "directory";

            // directory 종류이지만 outputPath 자체가 파일인 경우 (StandaloneWindows64 등):
            // exe + _Data/ 폴더를 모두 포함하는 부모 디렉토리를 스캔 대상으로 사용
            string scanRoot = outputPath;
            if (kind == OutputKind.Directory && File.Exists(outputPath))
                scanRoot = Path.GetDirectoryName(outputPath);

            long totalSizeBytes = 0;
            string artifactSha256 = null;
            string manifestSha256 = null;

            try
            {
                if (kind == OutputKind.File)
                {
                    totalSizeBytes = new FileInfo(outputPath).Length;
                    artifactSha256 = ComputeFileSha256(outputPath);
                }
                else
                {
                    // directory / project: recursive sum + manifest (scanRoot 기준)
                    if (!string.IsNullOrEmpty(scanRoot) && Directory.Exists(scanRoot))
                    {
                        totalSizeBytes = ComputeDirectorySize(scanRoot);
                        manifestSha256 = ComputeDirectoryManifestSha256(scanRoot);
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[unictl] BuildMetadata: hash/size 계산 중 예외 발생 (outputPath={outputPath}): {ex.Message}");
                // 해당 필드만 null — 빌드 state에는 영향 없음
            }

            var (primaryPath, execPath) = SelectArtifactPaths(outputPath, target, kind);

            var obj = new JObject
            {
                ["output_kind"] = kindStr,
                ["total_size_bytes"] = totalSizeBytes,
                ["primary_artifact_path"] = primaryPath,
            };

            // null 가능 필드 — JToken null로 명시 기록
            obj["artifact_sha256"] = artifactSha256 != null ? (JToken)artifactSha256 : JValue.CreateNull();
            obj["directory_manifest_sha256"] = manifestSha256 != null ? (JToken)manifestSha256 : JValue.CreateNull();
            obj["executable_path"] = execPath != null ? (JToken)execPath : JValue.CreateNull();

            return obj;
        }

        // ---------------------------------
        // output_kind 판정
        // ---------------------------------

        static OutputKind DetermineOutputKind(string outputPath, BuildTarget target)
        {
            // Standalone 타겟: exe/x86_64/app 경로가 파일이더라도
            // Unity가 <Name>_Data/ 등 동반 폴더를 항상 생성 → directory
            switch (target)
            {
                case BuildTarget.StandaloneWindows:
                case BuildTarget.StandaloneWindows64:
                case BuildTarget.StandaloneLinux64:
                case BuildTarget.StandaloneOSX:
                    return OutputKind.Directory;

                case BuildTarget.iOS:
                case BuildTarget.WebGL:
                    return OutputKind.Project;
            }

            // 나머지: outputPath 형태로 판정 (APK/AAB 등 단일 파일)
            if (!Directory.Exists(outputPath) && File.Exists(outputPath))
                return OutputKind.File;

            return OutputKind.Directory;
        }

        // ---------------------------------
        // primary_artifact_path + executable_path 선택
        // ---------------------------------

        static (string primary, string exec) SelectArtifactPaths(
            string outputPath, BuildTarget target, OutputKind kind)
        {
            if (kind == OutputKind.File)
            {
                // APK — executable_path = outputPath
                // AAB — executable_path = null (실행 불가 번들)
                bool isAab = outputPath.EndsWith(".aab", StringComparison.OrdinalIgnoreCase);
                return (outputPath, isAab ? null : outputPath);
            }

            switch (target)
            {
                case BuildTarget.StandaloneOSX:
                {
                    // .app 번들: primary = .app 루트, executable = Contents/MacOS/<ProductName>
                    var productName = PlayerSettings.productName ?? "Game";
                    var execPath = Path.Combine(outputPath, "Contents", "MacOS", productName);
                    return (outputPath, execPath);
                }

                case BuildTarget.iOS:
                {
                    // Xcode 프로젝트 디렉토리: primary = pbxproj, executable = null
                    var pbxproj = Path.Combine(outputPath, "Unity-iPhone.xcodeproj", "project.pbxproj");
                    return (pbxproj, null);
                }

                case BuildTarget.WebGL:
                {
                    // 웹사이트 디렉토리: primary = index.html, executable = null
                    var indexHtml = Path.Combine(outputPath, "index.html");
                    return (indexHtml, null);
                }

                case BuildTarget.StandaloneWindows:
                case BuildTarget.StandaloneWindows64:
                case BuildTarget.StandaloneLinux64:
                {
                    // exe/x86_64: primary = outputPath(exe), executable = outputPath
                    return (outputPath, outputPath);
                }

                default:
                    // fallback: primary = outputPath, executable = null
                    return (outputPath, null);
            }
        }

        // ---------------------------------
        // 해시 / 사이즈 계산
        // ---------------------------------

        internal static string ComputeFileSha256(string filePath)
        {
            using var sha = SHA256.Create();
            using var fs = File.OpenRead(filePath);
            var hash = sha.ComputeHash(fs);
            return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        }

        static long ComputeDirectorySize(string dirPath)
        {
            long total = 0;
            foreach (var f in Directory.EnumerateFiles(dirPath, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(f).Length; }
                catch { /* 개별 파일 접근 실패 무시 */ }
            }
            return total;
        }

        static string ComputeDirectoryManifestSha256(string dirPath)
        {
            // 정규화된 UTF-8 텍스트: sorted rel-path + size + per-file sha256
            var files = Directory.EnumerateFiles(dirPath, "*", SearchOption.AllDirectories)
                .Select(f =>
                {
                    var relPath = Path.GetRelativePath(dirPath, f).Replace('\\', '/');
                    long size;
                    string sha;
                    try
                    {
                        size = new FileInfo(f).Length;
                        sha = ComputeFileSha256(f);
                    }
                    catch
                    {
                        size = -1;
                        sha = "error";
                    }
                    return (relPath, size, sha);
                })
                .OrderBy(x => x.relPath, StringComparer.Ordinal)
                .ToArray();

            var sb = new StringBuilder();
            foreach (var (relPath, size, sha) in files)
                sb.Append(relPath).Append(' ').Append(size).Append(' ').Append(sha).Append('\n');

            var bytes = Encoding.UTF8.GetBytes(sb.ToString());
            using var sha256 = SHA256.Create();
            return BitConverter.ToString(sha256.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
    }
}
