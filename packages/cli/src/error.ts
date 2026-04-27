/**
 * Shared error utilities for unictl CLI.
 * Centralizes errorExit and hint_command lookup so every emit point
 * produces a consistent JSON shape.
 */
import errorRegistry from "./error-registry.json" assert { type: "json" };

type RegistryEntry = {
  kind: string;
  hint_command: string | null;
};

const registryMap: Map<string, RegistryEntry> = new Map(
  (errorRegistry.kinds as RegistryEntry[]).map((e) => [e.kind, e])
);

/**
 * Look up the hint_command template for an error kind.
 * Returns null when the kind is unknown or has no template.
 */
export function lookupHintCommand(kind: string): string | null {
  return registryMap.get(kind)?.hint_command ?? null;
}

/**
 * Emit a structured error JSON to stderr and exit with the given code.
 * Automatically appends hint_command from the error registry.
 */
export function errorExit(code: number, kind: string, message: string, hint?: string): never {
  const hint_command = lookupHintCommand(kind);
  process.stderr.write(
    JSON.stringify({
      ok: false,
      error: {
        kind,
        message,
        hint: hint ?? "",
        hint_command,
      },
    }) + "\n"
  );
  process.exit(code);
}
