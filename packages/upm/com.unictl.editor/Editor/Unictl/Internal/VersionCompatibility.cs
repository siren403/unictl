using System;
using Newtonsoft.Json.Linq;

namespace Unictl.Internal
{
    internal enum VersionCompatibilityStatus
    {
        Compatible,
        CliTooOld,
        CliVersionUnknown,
        CliVersionInvalid
    }

    internal static class VersionCompatibility
    {
        internal static JObject BuildDiagnostic(JObject parameters)
        {
            var cliVersion = GetCliVersion(parameters);
            var status = GetStatus(cliVersion);
            return new JObject
            {
                ["cli_version_seen"] = cliVersion == null ? JValue.CreateNull() : cliVersion,
                ["upm_version"] = UnictlVersion.PackageVersion,
                ["required_cli_version"] = UnictlVersion.PackageVersion,
                ["required_upm_version"] = UnictlVersion.PackageVersion,
                ["compatibility"] = new JObject
                {
                    ["status"] = StatusName(status),
                    ["required_cli_version"] = UnictlVersion.PackageVersion,
                    ["required_upm_version"] = UnictlVersion.PackageVersion
                }
            };
        }

        internal static object Check(string toolName, JObject parameters)
        {
            var action = parameters?["action"]?.ToString();
            if (IsDiagnosticTool(toolName, action))
                return null;

            var cliVersion = GetCliVersion(parameters);
            var status = GetStatus(cliVersion);
            if (status == VersionCompatibilityStatus.Compatible)
                return null;

            var kind = status == VersionCompatibilityStatus.CliTooOld
                ? "unictl_cli_too_old"
                : status == VersionCompatibilityStatus.CliVersionInvalid
                    ? "unictl_cli_version_invalid"
                    : "unictl_cli_version_unknown";
            var message = status == VersionCompatibilityStatus.CliTooOld
                ? $"unictl CLI {cliVersion} is older than Unity UPM package {UnictlVersion.PackageVersion}."
                : status == VersionCompatibilityStatus.CliVersionInvalid
                    ? $"unictl CLI version '{cliVersion}' could not be parsed. Update unictl CLI before continuing."
                    : "unictl CLI version is unknown. Update unictl CLI before continuing.";

            var context = BuildDiagnostic(parameters);
            context["kind"] = kind;
            context["tool"] = toolName;
            context["action"] = action == null ? JValue.CreateNull() : action;
            context["cli_update_required"] = true;
            context["workflow_safe"] = false;
            context["recommended_action"] = "update_unictl_cli";
            context["recommended_commands"] = new JArray(
                $"bunx unictl@{UnictlVersion.PackageVersion} <same command>",
                $"npm install -g unictl@{UnictlVersion.PackageVersion}"
            );

            return new Unictl.ErrorResponse(message, new
            {
                kind,
                cli_update_required = true,
                workflow_safe = false,
                cli_version_seen = cliVersion,
                upm_version = UnictlVersion.PackageVersion,
                required_cli_version = UnictlVersion.PackageVersion,
                recommended_action = "update_unictl_cli",
                recommended_commands = new[]
                {
                    $"bunx unictl@{UnictlVersion.PackageVersion} <same command>",
                    $"npm install -g unictl@{UnictlVersion.PackageVersion}"
                },
                tool = toolName,
                action,
                compatibility = context["compatibility"]
            })
            {
                error = new
                {
                    kind,
                    message,
                    recovery = "Update unictl CLI before retrying editor-side workflows.",
                    related = new[] { "doctor", "editor.status" },
                    context,
                    hint_command = $"bunx unictl@{UnictlVersion.PackageVersion} <same command>"
                }
            };
        }

        private static string GetCliVersion(JObject parameters)
        {
            return parameters?["_meta"]?["cli_version"]?.ToString();
        }

        private static VersionCompatibilityStatus GetStatus(string cliVersion)
        {
            if (string.IsNullOrWhiteSpace(cliVersion))
                return VersionCompatibilityStatus.CliVersionUnknown;
            if (!SemVer.TryParse(cliVersion, out var cli) || !SemVer.TryParse(UnictlVersion.PackageVersion, out var upm))
                return VersionCompatibilityStatus.CliVersionInvalid;
            return cli.CompareTo(upm) < 0
                ? VersionCompatibilityStatus.CliTooOld
                : VersionCompatibilityStatus.Compatible;
        }

        private static string StatusName(VersionCompatibilityStatus status)
        {
            switch (status)
            {
                case VersionCompatibilityStatus.CliTooOld: return "cli_too_old";
                case VersionCompatibilityStatus.CliVersionInvalid: return "cli_version_invalid";
                case VersionCompatibilityStatus.CliVersionUnknown: return "cli_version_unknown";
                default: return "compatible";
            }
        }

        private static bool IsDiagnosticTool(string toolName, string action)
        {
            switch (toolName)
            {
                case "list":
                case "ping":
                case "build_status":
                    return true;
                case "editor_log":
                    return action == "tail" || action == "search" || action == "errors";
                case "editor_control":
                    return action == "status";
                case "execute_menu":
                    return action == "search" || action == "list";
                default:
                    return false;
            }
        }

        private struct SemVer : IComparable<SemVer>
        {
            private readonly int _major;
            private readonly int _minor;
            private readonly int _patch;
            private readonly string _preRelease;

            private SemVer(int major, int minor, int patch, string preRelease)
            {
                _major = major;
                _minor = minor;
                _patch = patch;
                _preRelease = preRelease;
            }

            public static bool TryParse(string value, out SemVer version)
            {
                version = default;
                if (string.IsNullOrWhiteSpace(value)) return false;
                var text = value.Trim();
                if (text.StartsWith("v", StringComparison.OrdinalIgnoreCase))
                    text = text.Substring(1);
                var buildIndex = text.IndexOf('+');
                if (buildIndex >= 0) text = text.Substring(0, buildIndex);
                string pre = null;
                var preIndex = text.IndexOf('-');
                if (preIndex >= 0)
                {
                    pre = text.Substring(preIndex + 1);
                    text = text.Substring(0, preIndex);
                }
                var parts = text.Split('.');
                if (parts.Length != 3) return false;
                if (!int.TryParse(parts[0], out var major)) return false;
                if (!int.TryParse(parts[1], out var minor)) return false;
                if (!int.TryParse(parts[2], out var patch)) return false;
                version = new SemVer(major, minor, patch, pre);
                return true;
            }

            public int CompareTo(SemVer other)
            {
                var major = _major.CompareTo(other._major);
                if (major != 0) return major;
                var minor = _minor.CompareTo(other._minor);
                if (minor != 0) return minor;
                var patch = _patch.CompareTo(other._patch);
                if (patch != 0) return patch;

                var thisStable = string.IsNullOrEmpty(_preRelease);
                var otherStable = string.IsNullOrEmpty(other._preRelease);
                if (thisStable && otherStable) return 0;
                if (thisStable) return 1;
                if (otherStable) return -1;
                return string.CompareOrdinal(_preRelease, other._preRelease);
            }
        }
    }
}
