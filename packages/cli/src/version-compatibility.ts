import { getCliPackageMeta } from "./meta";
import { lookupCode } from "./error";

type VersionStatus = "compatible" | "cli_too_old" | "upm_too_old" | "upm_version_unknown" | "version_invalid";

type SemVer = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

function parseSemVer(value: string | null | undefined): SemVer | null {
  if (!value) return null;
  let text = value.trim();
  if (text.toLowerCase().startsWith("v")) text = text.slice(1);
  text = text.split("+", 1)[0];
  const [core, prerelease = null] = text.split("-", 2);
  const parts = core.split(".");
  if (parts.length !== 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;
  const [major, minor, patch] = parts.map((part) => Number.parseInt(part, 10));
  if (![major, minor, patch].every(Number.isInteger)) return null;
  return { major, minor, patch, prerelease };
}

function compareSemVer(a: SemVer, b: SemVer): number {
  for (const key of ["major", "minor", "patch"] as const) {
    const delta = a[key] - b[key];
    if (delta !== 0) return delta;
  }
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function isVersionSafeCommand(tool: string, params?: Record<string, unknown>): boolean {
  const action = typeof params?.action === "string" ? params.action : undefined;
  if (tool === "list" || tool === "ping" || tool === "build_status") return true;
  if (tool === "editor_control") return action === "status";
  if (tool === "editor_log") return action === "tail" || action === "search" || action === "errors";
  if (tool === "execute_menu") return action === "search" || action === "list";
  return false;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function extractUpmVersion(response: unknown): string | null {
  const root = record(response);
  const data = record(root?.data);
  const unictl = record(data?.unictl) ?? record(root?.unictl);
  const version = unictl?.upm_version;
  return typeof version === "string" ? version : null;
}

export function compatibilityStatus(upmVersion: string | null): VersionStatus {
  if (!upmVersion) return "upm_version_unknown";
  const cli = parseSemVer(getCliPackageMeta().version);
  const upm = parseSemVer(upmVersion);
  if (!cli || !upm) return "version_invalid";
  const cmp = compareSemVer(cli, upm);
  if (cmp < 0) return "cli_too_old";
  if (cmp > 0) return "upm_too_old";
  return "compatible";
}

export function buildVersionMismatchError(
  status: VersionStatus,
  opts: {
    tool: string;
    action?: string;
    upmVersion: string | null;
  },
) {
  const cliVersion = getCliPackageMeta().version;
  const action = opts.action ?? null;
  const kind = status === "cli_too_old"
    ? "unictl_cli_too_old"
    : status === "version_invalid"
      ? "unictl_version_invalid"
      : opts.upmVersion
        ? "unictl_upm_too_old"
        : "unictl_upm_version_unknown";
  const upmUpdateCommands = [
    `unictl init --version ${cliVersion} --force`,
    "unictl editor restart",
  ];
  const cliUpdateCommands = opts.upmVersion
    ? [
        `bunx unictl@${opts.upmVersion} <same command>`,
        `npm install -g unictl@${opts.upmVersion}`,
      ]
    : ["bunx unictl@latest <same command>", "npm install -g unictl@latest"];
  const recommendedCommands = kind === "unictl_cli_too_old" ? cliUpdateCommands : upmUpdateCommands;
  const message = kind === "unictl_cli_too_old"
    ? `unictl CLI ${cliVersion} is older than Unity UPM package ${opts.upmVersion}.`
    : kind === "unictl_upm_version_unknown"
      ? "Unity UPM package did not report unictl version metadata. Update com.unictl.editor before running editor-side workflows."
      : kind === "unictl_version_invalid"
        ? "Could not compare unictl CLI and Unity UPM package versions."
        : `Unity UPM package ${opts.upmVersion} is older than unictl CLI ${cliVersion}.`;

  return {
    ok: false,
    error: {
      code: lookupCode(kind),
      kind,
      message,
      recovery: kind === "unictl_cli_too_old"
        ? "Update unictl CLI before retrying editor-side workflows."
        : "Update com.unictl.editor in the Unity project, then restart the editor.",
      related: ["doctor", "editor.status"],
      context: {
        tool: opts.tool,
        action,
        workflow_safe: false,
        cli_version: cliVersion,
        upm_version: opts.upmVersion,
        required_cli_version: opts.upmVersion ?? cliVersion,
        required_upm_version: cliVersion,
        compatibility: { status },
        recommended_action: kind === "unictl_cli_too_old" ? "update_unictl_cli" : "update_unity_upm_package",
        recommended_commands: recommendedCommands,
      },
      hint_command: recommendedCommands[0],
      hint_text: null,
      exit_code: 1,
    },
  };
}
