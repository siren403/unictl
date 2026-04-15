#!/usr/bin/env bun
/**
 * unictl release script
 *
 * Usage:
 *   bun run release          → patch (0.1.2 → 0.1.3)
 *   bun run release minor    → minor (0.1.2 → 0.2.0)
 *   bun run release major    → major (0.1.2 → 1.0.0)
 *   bun run release 0.2.0    → exact version
 *
 * Flags:
 *   --no-publish    skip npm publish (git only)
 *
 * Does:
 *   1. Bump version in all package.json files
 *   2. Commit
 *   3. Tag vX.Y.Z
 *   4. Push main + tag
 *   5. npm publish packages/cli (unless --no-publish)
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const ROOT = import.meta.dir + "/..";

// All package.json files that share the unictl version.
// Listed in the order we update them; release.ts always syncs them.
const VERSIONED_PACKAGES = [
  join(ROOT, "package.json"),                                       // repo meta
  join(ROOT, "packages/cli/package.json"),                          // npm-published CLI
  join(ROOT, "packages/upm/com.unictl.editor/package.json"),        // Unity UPM
];

const CLI_PACKAGE_DIR = join(ROOT, "packages/cli");

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(VERSIONED_PACKAGES[0], "utf-8"));
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
  for (const path of VERSIONED_PACKAGES) {
    const pkg = JSON.parse(readFileSync(path, "utf-8"));
    pkg.version = version;
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  }
}

function run(cmd: string[], opts?: { cwd?: string }): void {
  const result = Bun.spawnSync(cmd, {
    cwd: opts?.cwd ?? ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.error(`Failed: ${cmd.join(" ")}`);
    process.exit(1);
  }
}

// --- main ---

const args = process.argv.slice(2);
const skipPublish = args.includes("--no-publish");
const bumpArg = args.find((a) => !a.startsWith("--")) ?? "patch";

const current = readVersion();
const next = bumpVersion(current, bumpArg);

console.log(`\n  ${current} → ${next}${skipPublish ? " (git only)" : ""}\n`);

updatePackageJsons(next);

run(["git", "add", ...VERSIONED_PACKAGES]);
run(["git", "commit", "-m", `release: v${next}`]);
run(["git", "tag", `v${next}`]);
run(["git", "push", "origin", "main", `v${next}`]);

if (!skipPublish) {
  console.log("\n  npm publish packages/cli\n");
  run(["npm", "publish", "--access", "public"], { cwd: CLI_PACKAGE_DIR });
}

console.log(`\n  ✓ v${next} released\n`);
