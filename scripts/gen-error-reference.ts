#!/usr/bin/env bun
/**
 * Generates docs/standalone/error-reference.md from packages/cli/src/error-registry.json.
 * Do not edit the output file by hand; run: bun run scripts/gen-error-reference.ts
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..");

interface ErrorKind {
  kind: string;
  emitted_from: string[];
  exit_code: number;
  hint_text: string;
  hint_command: string | null;
  since_version: string;
}

interface ErrorRegistry {
  schema_version: number;
  kinds: ErrorKind[];
}

const registryPath = join(repoRoot, "packages", "cli", "src", "error-registry.json");
const registry: ErrorRegistry = JSON.parse(readFileSync(registryPath, "utf-8"));

const rows = registry.kinds.map((k) => {
  const emittedFrom = k.emitted_from.length > 0 ? k.emitted_from.join(", ") : "—";
  const hint = k.hint_text.replace(/\|/g, "\\|");
  return `| \`${k.kind}\` | ${emittedFrom} | ${k.exit_code} | ${hint} |`;
});

const table = [
  "| Kind | Emitted From | Exit Code | Hint |",
  "|------|-------------|-----------|------|",
  ...rows,
].join("\n");

const content = `<!-- Do not edit by hand; run \`bun run gen:error-ref\` to regenerate -->
# unictl Error Reference

This document is auto-generated from \`packages/cli/src/error-registry.json\`.

## Error Kinds

${table}

## Exit Code Summary

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Build/operation failed (build_failed, build_exception, compile_failed, cancelled_by_user) |
| 2 | Param/validation error (invalid inputs, unsupported profile, path errors) |
| 3 | Lane/resource unavailable (editor busy, project locked, IPC errors) |
| 124 | Client wait timeout (build still running) |
| 125 | unictl internal error |
`;

const outputPath = join(repoRoot, "docs", "standalone", "error-reference.md");
writeFileSync(outputPath, content, "utf-8");
console.log(`Written: ${outputPath}`);
