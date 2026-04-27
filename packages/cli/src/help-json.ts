/**
 * formatHelpJson — emits structured JSON help derived from capabilities.json.
 *
 * unictl --help --json          → top-level view: version + subcommands
 * unictl <cmd> --help --json    → subcommand view: name + flags + exit_codes
 */
import caps from "./capabilities.json" assert { type: "json" };
import { getCliPackageMeta } from "./meta";

type SubcommandEntry = {
  name: string;
  description: string;
  key_flags: string[];
};

type ExitCodeEntry = {
  code: number;
  meaning: string;
};

type FlagEntry = {
  name: string;
  type: string;
  description: string;
  default: string | boolean | null;
  required: boolean;
};

/**
 * Returns a JSON-serialisable help object.
 *
 * @param cmdName  If undefined → top-level help.  Otherwise the subcommand name.
 * @param argsDef  Optional: citty args definition for the subcommand, used to
 *                 produce the full flag schema when capabilities.json only has key_flags.
 */
export function formatHelpJson(
  cmdName?: string,
  argsDef?: Record<string, { type?: string; description?: string; default?: unknown; required?: boolean }>
): unknown {
  if (!cmdName) {
    // Top-level view
    const version = getCliPackageMeta().version;
    const subcommands = (caps.subcommands as SubcommandEntry[]).map((sc) => ({
      name: sc.name,
      description: sc.description,
    }));
    return { version, subcommands };
  }

  // Subcommand view
  const sc = (caps.subcommands as SubcommandEntry[]).find((s) => s.name === cmdName);

  const flags: FlagEntry[] = argsDef
    ? Object.entries(argsDef).map(([name, def]) => ({
        name,
        type: def.type ?? "string",
        description: def.description ?? "",
        default: def.default !== undefined ? (def.default as string | boolean | null) : null,
        required: def.required ?? false,
      }))
    : (sc?.key_flags ?? []).map((f) => ({
        name: f.replace(/^--?/, ""),
        type: "string",
        description: "",
        default: null,
        required: false,
      }));

  return {
    name: cmdName,
    description: sc?.description ?? "",
    flags,
    exit_codes: caps.exit_codes as ExitCodeEntry[],
  };
}
