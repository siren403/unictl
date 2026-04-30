#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

type Finding = {
  path: string;
  guid: string;
  reason: string;
};

const repoRoot = join(import.meta.dir, "..");
const packageRoot = join(repoRoot, "packages", "upm", "com.unictl.editor");

const placeholderGuids = new Set([
  "00000000000000000000000000000000",
  "11111111111111111111111111111111",
  "22222222222222222222222222222222",
  "33333333333333333333333333333333",
  "44444444444444444444444444444444",
  "55555555555555555555555555555555",
  "66666666666666666666666666666666",
  "77777777777777777777777777777777",
  "88888888888888888888888888888888",
  "99999999999999999999999999999999",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "cccccccccccccccccccccccccccccccc",
  "dddddddddddddddddddddddddddddddd",
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "ffffffffffffffffffffffffffffffff",
  "1234567890abcdef1234567890abcdef",
  "abcdef1234567890abcdef1234567890",
  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
]);

function walk(dir: string): string[] {
  const entries = readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    return path.endsWith(".meta") ? [path] : [];
  });
  return entries;
}

function extractGuid(path: string): string | null {
  const content = readFileSync(path, "utf-8");
  const match = content.match(/^guid:\s*([a-fA-F0-9]{32})\s*$/m);
  return match ? match[1].toLowerCase() : null;
}

function looksSequential(guid: string): boolean {
  const ascending = "0123456789abcdef0123456789abcdef";
  const descending = "fedcba9876543210fedcba9876543210";
  return ascending.includes(guid.slice(0, 16)) || descending.includes(guid.slice(0, 16));
}

function hasLowDiversity(guid: string): boolean {
  return new Set(guid).size <= 4;
}

function validate(): Finding[] {
  if (!existsSync(packageRoot)) {
    return [{ path: relative(repoRoot, packageRoot), guid: "", reason: "UPM package root not found" }];
  }

  const findings: Finding[] = [];
  const seen = new Map<string, string>();

  for (const path of walk(packageRoot)) {
    const rel = relative(repoRoot, path).replace(/\\/g, "/");
    const guid = extractGuid(path);
    if (!guid) {
      findings.push({ path: rel, guid: "", reason: "missing 32-character hex guid" });
      continue;
    }

    const duplicate = seen.get(guid);
    if (duplicate) {
      findings.push({ path: rel, guid, reason: `duplicate guid already used by ${duplicate}` });
    } else {
      seen.set(guid, rel);
    }

    if (placeholderGuids.has(guid)) {
      findings.push({ path: rel, guid, reason: "known placeholder/sample guid" });
    } else if (looksSequential(guid)) {
      findings.push({ path: rel, guid, reason: "sequential-looking guid" });
    } else if (hasLowDiversity(guid)) {
      findings.push({ path: rel, guid, reason: "low-diversity guid" });
    }
  }

  return findings;
}

const findings = validate();
if (findings.length > 0) {
  console.error("Unity .meta GUID validation failed:");
  for (const finding of findings) {
    const guid = finding.guid ? ` (${finding.guid})` : "";
    console.error(`- ${finding.path}${guid}: ${finding.reason}`);
  }
  process.exit(1);
}

console.log("Unity .meta GUID validation passed.");
