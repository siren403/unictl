#!/usr/bin/env bun
/**
 * unictl release script
 *
 * Usage:
 *   bun run release          → patch (0.1.1 → 0.1.2)
 *   bun run release minor    → minor (0.1.1 → 0.2.0)
 *   bun run release major    → major (0.1.1 → 1.0.0)
 *   bun run release 0.2.0    → exact version
 *
 * Does:
 *   1. Bump version in all 3 package.json files
 *   2. Commit
 *   3. Tag
 *   4. Push (main + tag)
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = import.meta.dir + "/..";

const PACKAGE_JSONS = [
  join(ROOT, "package.json"),
  join(ROOT, "packages/cli/package.json"),
  join(ROOT, "packages/upm/com.unictl.editor/package.json"),
];

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSONS[0], "utf-8"));
  return pkg.version;
}

function bumpVersion(current: string, type: string): string {
  if (/^\d+\.\d+\.\d+$/.test(type)) return type;

  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
    default: return `${major}.${minor}.${patch + 1}`;
  }
}

function updatePackageJsons(version: string): void {
  for (const path of PACKAGE_JSONS) {
    const pkg = JSON.parse(readFileSync(path, "utf-8"));
    pkg.version = version;
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  }
}

function run(cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    console.error(`Failed: ${cmd.join(" ")}`);
    process.exit(1);
  }
}

// --- main ---

const arg = process.argv[2] ?? "patch";
const current = readVersion();
const next = bumpVersion(current, arg);

console.log(`\n  ${current} → ${next}\n`);

updatePackageJsons(next);

run(["git", "add", ...PACKAGE_JSONS]);
run(["git", "commit", "-m", `release: v${next}`]);
run(["git", "tag", `v${next}`]);
run(["git", "push", "origin", "main", `v${next}`]);

console.log(`\n  ✓ v${next} released\n`);
