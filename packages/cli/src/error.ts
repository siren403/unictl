/**
 * Shared error utilities for unictl CLI.
 *
 * v0.7 envelope (per A4 + critic 1.5 + plan E):
 *   { ok: false, error: { code, kind, message, recovery, related, context, hint_command, hint_text } }
 *
 * v0.6 envelope (legacy callers; preserved for backward compat until v1.0):
 *   { ok: false, error: { kind, message, hint_command, hint } }
 *
 * The two envelopes coexist via dual emission — every emit point that uses
 * `errorExit` continues to work; newer call sites that want the structured
 * v0.7 fields use `errorEnvelope` to build the payload.
 */
import errorRegistry from "./error-registry.json" assert { type: "json" };
import codeAllocations from "./code-allocations.json" assert { type: "json" };

type RegistryEntry = {
  kind: string;
  hint_command: string | null;
};

type CodeAllocation = {
  kind: string;
  code: number;
};

const registryMap: Map<string, RegistryEntry> = new Map(
  (errorRegistry.kinds as RegistryEntry[]).map((e) => [e.kind, e])
);

const codeMap: Map<string, number> = new Map(
  (codeAllocations.allocations as CodeAllocation[]).map((a) => [a.kind, a.code])
);

/**
 * Look up the hint_command template for an error kind.
 * Returns null when the kind is unknown or has no template.
 */
export function lookupHintCommand(kind: string): string | null {
  return registryMap.get(kind)?.hint_command ?? null;
}

/**
 * Look up the numeric code for an error kind.
 * Returns 0 (the reserved "no error" sentinel) for unknown kinds — caller may
 * choose to treat that as a registration gap.
 */
export function lookupCode(kind: string): number {
  return codeMap.get(kind) ?? 0;
}

export interface ErrorEnvelopeFields {
  kind: string;
  message: string;
  /** Concrete next action the caller should take. Optional. */
  recovery?: string;
  /** Names of related commands (matches CommandSchema.name). */
  related?: readonly string[];
  /** Structured payload for agent decision-making. */
  context?: Record<string, unknown>;
  /** Override hint_command lookup (rare). */
  hint_command?: string | null;
  /** Override hint_text lookup (rare). */
  hint_text?: string;
}

/**
 * Build the v0.7 structured error envelope. Code is auto-resolved from kind.
 *
 * Returns the wrapper object including `ok: false` so callers can `output(...)`
 * the result directly.
 */
export function errorEnvelope(fields: ErrorEnvelopeFields): {
  ok: false;
  error: {
    code: number;
    kind: string;
    message: string;
    recovery: string | null;
    related: readonly string[];
    context: Record<string, unknown> | null;
    hint_command: string | null;
    hint_text: string | null;
  };
} {
  return {
    ok: false,
    error: {
      code: lookupCode(fields.kind),
      kind: fields.kind,
      message: fields.message,
      recovery: fields.recovery ?? null,
      related: fields.related ?? [],
      context: fields.context ?? null,
      hint_command: fields.hint_command !== undefined ? fields.hint_command : lookupHintCommand(fields.kind),
      hint_text: fields.hint_text ?? null,
    },
  };
}

/**
 * Emit a structured error JSON to stderr and exit with the given code.
 * Automatically appends hint_command from the error registry.
 *
 * Legacy v0.6 shape preserved for backward compat; v0.7 callers should
 * prefer `errorEnvelope` + their own emit path so the structured fields
 * (recovery, related, context) survive.
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
