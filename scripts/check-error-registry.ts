#!/usr/bin/env bun
/**
 * CI drift check: validates that error-registry.json, CLI errorExit() calls,
 * C# BuildError() calls, and HintTable.cs are all consistent.
 * Also validates capabilities.json ↔ error-registry.json consistency and
 * version sync between capabilities.json and package.json.
 *
 * Exit 0 = all consistent. Exit 1 = drift detected (details printed to stderr).
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// 1. Parse registry
// ---------------------------------------------------------------------------

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
const registeredKinds = new Set(registry.kinds.map((k) => k.kind));

// ---------------------------------------------------------------------------
// 2. Grep CLI errorExit( kinds
// ---------------------------------------------------------------------------

function readDir(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(ext))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

function extractErrorExitKinds(files: string[]): Set<string> {
  const kinds = new Set<string>();
  const pattern = /errorExit\s*\(\s*\d+\s*,\s*["']([^"']+)["']/g;
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      kinds.add(m[1]);
    }
  }
  return kinds;
}

const cliSrcDir = join(repoRoot, "packages", "cli", "src");
const cliFiles = readDir(cliSrcDir, ".ts");
const cliKinds = extractErrorExitKinds(cliFiles);

// ---------------------------------------------------------------------------
// 3. Grep C# BuildError( kinds
// ---------------------------------------------------------------------------

function findCsFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(d: string) {
    let entries: string[];
    try {
      entries = readdirSync(d, { withFileTypes: true } as any) as any[];
    } catch {
      return;
    }
    for (const entry of entries as any[]) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".cs")) results.push(full);
    }
  }
  walk(dir);
  return results;
}

function extractBuildErrorKinds(files: string[]): Set<string> {
  const kinds = new Set<string>();
  const pattern = /BuildError\s*\(\s*["']([^"']+)["']/g;
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      kinds.add(m[1]);
    }
  }
  return kinds;
}

const csDir = join(repoRoot, "packages", "upm", "com.unictl.editor", "Editor", "Unictl");
const csFiles = findCsFiles(csDir);
const csKinds = extractBuildErrorKinds(csFiles);

// ---------------------------------------------------------------------------
// 4. Parse HintTable.cs keys
// ---------------------------------------------------------------------------

function extractHintTableKeys(hintTablePath: string): Set<string> {
  const kinds = new Set<string>();
  const content = readFileSync(hintTablePath, "utf-8");
  const pattern = /\{\s*["']([^"']+)["']\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    kinds.add(m[1]);
  }
  return kinds;
}

const hintTablePath = join(csDir, "Internal", "HintTable.cs");
const hintTableKinds = extractHintTableKeys(hintTablePath);

// ---------------------------------------------------------------------------
// 5. Also extract kinds used in BuildStatusTool/BuildCancelTool (non-BuildError pattern)
// ---------------------------------------------------------------------------

function extractKindStringKinds(files: string[]): Set<string> {
  const kinds = new Set<string>();
  const pattern = /kind\s*=\s*["']([^"']+)["']/g;
  for (const file of files) {
    const content = readFileSync(file, "utf-8");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      // skip "usage" — it's a tool-response kind, not an error kind
      if (m[1] !== "usage") kinds.add(m[1]);
    }
  }
  return kinds;
}

const csToolKinds = extractKindStringKinds(csFiles);

// Union of all C#-emitted kinds
const allCsKinds = new Set([...csKinds, ...csToolKinds]);

// ---------------------------------------------------------------------------
// 6. Assert consistency
// ---------------------------------------------------------------------------

const allEmittedKinds = new Set([...cliKinds, ...allCsKinds]);

const failures: string[] = [];

// Assert: registry ⊇ (CLI ∪ C#)
for (const kind of allEmittedKinds) {
  if (!registeredKinds.has(kind)) {
    failures.push(`MISSING FROM REGISTRY: kind="${kind}" is emitted by code but not in error-registry.json`);
  }
}

// Assert: HintTable ⊇ (CLI ∪ C#) — every emitted kind should have a hint
for (const kind of allEmittedKinds) {
  if (!hintTableKinds.has(kind)) {
    // Some CLI-only kinds don't need HintTable (C# side); warn but don't fail
    // Only fail if it's a C#-emitted kind missing from HintTable
    if (allCsKinds.has(kind)) {
      failures.push(`MISSING FROM HINTTABLE: kind="${kind}" is emitted by C# but has no HintTable entry`);
    }
  }
}

// Assert: registry ⊆ HintTable (every registered kind has a hint entry)
// This is advisory — new CLI-only kinds may not need C#-side hints
// We check only kinds that are C#-emitted or already in HintTable
for (const kind of registeredKinds) {
  const isCSEmitted = allCsKinds.has(kind);
  const inHintTable = hintTableKinds.has(kind);
  if (isCSEmitted && !inHintTable) {
    failures.push(`REGISTRY/HINTTABLE MISMATCH: kind="${kind}" is in registry + C# code but missing from HintTable`);
  }
}

// ---------------------------------------------------------------------------
// 7. Capabilities drift check
// ---------------------------------------------------------------------------

interface CapabilitiesBuiltin {
  name: string;
  emits_error_kinds: string[];
}

interface CapabilitiesJson {
  schema_version: number;
  unictl_version: string;
  builtins: CapabilitiesBuiltin[];
}

const capabilitiesPath = join(repoRoot, "packages", "cli", "src", "capabilities.json");
const capabilities: CapabilitiesJson = JSON.parse(readFileSync(capabilitiesPath, "utf-8"));

// Assert: every emits_error_kinds entry in capabilities.json exists in error-registry.json
const capsMissingFromRegistry: string[] = [];
for (const builtin of capabilities.builtins) {
  for (const kind of builtin.emits_error_kinds) {
    if (!registeredKinds.has(kind)) {
      capsMissingFromRegistry.push(`capabilities.json builtin "${builtin.name}": kind="${kind}" not found in error-registry.json`);
    }
  }
}

for (const msg of capsMissingFromRegistry) {
  failures.push(`CAPABILITIES DRIFT: ${msg}`);
}

// Assert: capabilities.json unictl_version matches root package.json version
const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
const rootVersion: string = rootPkg.version;
if (capabilities.unictl_version !== rootVersion) {
  failures.push(
    `CAPABILITIES VERSION DRIFT: capabilities.json unictl_version="${capabilities.unictl_version}" does not match package.json version="${rootVersion}"`
  );
}

const capsKindCount = capabilities.builtins.reduce((acc, b) => acc + b.emits_error_kinds.length, 0);

// ---------------------------------------------------------------------------
// 8. Report
// ---------------------------------------------------------------------------

console.log(`Registry kinds:   ${registeredKinds.size}`);
console.log(`CLI kinds:        ${cliKinds.size} (${[...cliKinds].join(", ")})`);
console.log(`C# kinds:         ${allCsKinds.size} (${[...allCsKinds].join(", ")})`);
console.log(`HintTable keys:   ${hintTableKinds.size} (${[...hintTableKinds].join(", ")})`);
console.log(`All emitted:      ${allEmittedKinds.size}`);
console.log(`Capabilities:     ${capabilities.builtins.length} builtin(s), ${capsKindCount} emits_error_kinds ref(s), unictl_version=${capabilities.unictl_version}`);

if (failures.length > 0) {
  console.error(`\nDrift check FAILED (${failures.length} issue(s)):`);
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  process.exit(1);
} else {
  console.log("\nDrift check PASSED: registry, HintTable, and code are consistent.");
  console.log("Capabilities drift check PASSED: capabilities.json kinds and version are consistent.");
  process.exit(0);
}
