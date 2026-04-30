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
 *   --no-publish    skip npm publish only; still does commit/tag/push
 *   --dry-run       skip git push, git tag, git push tag, AND npm publish;
 *                   runs version sync + assemble + validation only; exits 0 on success
 *
 * Safe release order (eliminates orphan-tag risk):
 *   1. Bump version in all package.json + integration metadata files
 *   2. Validate CHANGELOG.md + promote [Unreleased] → [v<ver>] + update ROADMAP.md header
 *   3. git add + commit "release: v<ver>"  (local only)
 *   4. npm publish packages/cli  (skip if --no-publish or --dry-run)
 *   5. git push origin main      (skip if --dry-run)
 *   6. git tag v<ver>            (skip if --dry-run)
 *   7. git push origin v<ver>    (skip if --dry-run)
 *
 * Rationale: publish before push so a failed push never leaves an orphan public tag.
 * If step 4 fails, no public artifact exists; re-run is safe (idempotency guard).
 * If step 5 fails, published tarball exists but commit not yet public; manual: git push origin main.
 * If steps 6-7 fail, published + pushed but untagged; manual: git tag v<ver> HEAD && git push origin v<ver>.
 * See docs/standalone/release-process.md for full recovery table.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dir, "..");

// All package.json files that share the unictl version.
// Listed in the order we update them; release.ts always syncs them.
const VERSIONED_PACKAGES = [
  join(ROOT, "package.json"),                                      // repo meta
  join(ROOT, "packages/cli/package.json"),                         // npm-published CLI
  join(ROOT, "packages/upm/com.unictl.editor/package.json"),       // Unity UPM
];

// Integration metadata files also version-matched at release.
const VERSIONED_INTEGRATIONS = [
  join(ROOT, "integrations/codex/plugin.config.json"),
  join(ROOT, "integrations/claude-code/support-pack.json"),
];

// CLI source files with version fields that must stay in sync.
const VERSIONED_CLI = [
  join(ROOT, "packages/cli/src/capabilities.json"),
];

const ALL_VERSIONED = [...VERSIONED_PACKAGES, ...VERSIONED_INTEGRATIONS, ...VERSIONED_CLI];

const CLI_PACKAGE_DIR = join(ROOT, "packages/cli");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const ROADMAP_PATH   = join(ROOT, "docs/standalone/ROADMAP.md");

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(VERSIONED_PACKAGES[0], "utf-8"));
  return pkg.version;
}

function bumpVersion(current: string, type: string): string {
  if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(type)) return type;

  const [major, minor, patch] = current.split(".").map(Number);
  switch (type) {
    case "major": return `${major + 1}.0.0`;
    case "minor": return `${major}.${minor + 1}.0`;
    case "patch": return `${major}.${minor}.${patch + 1}`;
    default:      return `${major}.${minor}.${patch + 1}`;
  }
}

function updatePackageJsons(version: string): void {
  for (const path of ALL_VERSIONED) {
    const pkg = JSON.parse(readFileSync(path, "utf-8"));
    if ("unictl_version" in pkg) {
      pkg.unictl_version = version;
    } else {
      pkg.version = version;
    }
    writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");
  }
}

function validateChangelog(version: string): void {
  if (!existsSync(CHANGELOG_PATH)) {
    console.error(`\n  ERROR: CHANGELOG.md not found at ${CHANGELOG_PATH}`);
    console.error(`  Create CHANGELOG.md with an [Unreleased] section before releasing.\n`);
    process.exit(1);
  }

  const content = readFileSync(CHANGELOG_PATH, "utf-8");

  // Must have an [Unreleased] section
  if (!content.includes("## [Unreleased]")) {
    console.error(`\n  ERROR: CHANGELOG.md has no [Unreleased] section.`);
    console.error(`  Add an [Unreleased] section with at least one entry before releasing.\n`);
    process.exit(1);
  }

  // Extract the [Unreleased] section content (between ## [Unreleased] and the next ##)
  const unreleasedMatch = content.match(/## \[Unreleased\]([\s\S]*?)(?=\n## \[|$)/);
  if (!unreleasedMatch) {
    console.error(`\n  ERROR: Could not parse [Unreleased] section in CHANGELOG.md.\n`);
    process.exit(1);
  }

  const unreleasedBody = unreleasedMatch[1].trim();
  // Must have at least one bullet line
  if (!unreleasedBody || !/^[-*]/m.test(unreleasedBody)) {
    console.error(`\n  ERROR: CHANGELOG.md [Unreleased] section has no entries.`);
    console.error(`  Add at least one bullet under Added/Changed/Fixed/etc. before releasing.\n`);
    process.exit(1);
  }
}

function promoteChangelog(version: string): void {
  const content = readFileSync(CHANGELOG_PATH, "utf-8");
  const date = new Date().toISOString().slice(0, 10);
  const promoted = content.replace(
    /## \[Unreleased\](\r?\n)/,
    `## [Unreleased]$1$1---$1$1## [${version}] - ${date}$1`
  );
  if (promoted === content) {
    console.error("\n  ERROR: '## [Unreleased]' header not found in CHANGELOG.md.\n");
    process.exit(1);
  }
  writeFileSync(CHANGELOG_PATH, promoted);
}

function updateRoadmapHeader(version: string): void {
  if (!existsSync(ROADMAP_PATH)) return;
  const content = readFileSync(ROADMAP_PATH, "utf-8");
  const updated = content.replace(
    /## 현재 릴리즈 — `v\d+\.\d+\.\d+`/,
    `## 현재 릴리즈 — \`v${version}\``
  );
  writeFileSync(ROADMAP_PATH, updated);
}

function checkIdempotency(version: string): boolean {
  // Check if package.json already at target version AND a release commit for it exists
  const current = readVersion();
  if (current !== version) return false;

  const result = Bun.spawnSync(
    ["git", "log", "--oneline", "--grep", `release: v${version}`, "-1"],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
  );
  const output = result.stdout.toString().trim();
  return output.length > 0;
}

function run(cmd: string[], opts?: { cwd?: string }): void {
  const result = Bun.spawnSync(cmd, {
    cwd: opts?.cwd ?? ROOT,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) {
    console.error(`\n  Failed: ${cmd.join(" ")}\n`);
    process.exit(1);
  }
}

function runAssemble(version: string, outputDir?: string): void {
  const assembleScript = join(ROOT, "scripts", "release", "assemble.ts");
  const args = ["bun", "run", assembleScript];
  if (outputDir) {
    args.push("--output", outputDir);
  }
  console.log("\n  Running assemble.ts...\n");
  const result = Bun.spawnSync(args, {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "inherit",
    env: { ...process.env },
  });
  if (result.exitCode !== 0) {
    console.error(`\n  assemble.ts failed\n`);
    process.exit(1);
  }
  try {
    const parsed = JSON.parse(result.stdout.toString());
    if (!parsed.success) {
      console.error(`\n  assemble.ts reported failure: ${parsed.message}\n`);
      if (parsed.data?.mismatches) {
        console.error("  Version mismatches:", JSON.stringify(parsed.data.mismatches, null, 2));
      }
      process.exit(1);
    }
    console.log(`  assemble: ${parsed.message}`);
    if (parsed.data?.output_root) {
      console.log(`  artifacts at: ${parsed.data.output_root}`);
    }
  } catch {
    // assemble printed non-JSON; treat as success if exit 0
    console.log("  assemble.ts completed.");
  }
}

function runValidationScripts(): void {
  console.log("  Running validation scripts");
  run(["bun", "run", "scripts/check-error-registry.ts"]);
  run(["bun", "run", "scripts/check-unity-meta-guids.ts"]);
}

// --- main ---

const args = process.argv.slice(2);

// Mutex: --dry-run and --no-publish are mutually exclusive
const isDryRun    = args.includes("--dry-run");
const skipPublish = args.includes("--no-publish");

if (isDryRun && skipPublish) {
  console.error("\n  ERROR: --dry-run and --no-publish are mutually exclusive.\n");
  process.exit(1);
}

const bumpArg = args.find((a) => !a.startsWith("--")) ?? "patch";
const current = readVersion();
const next = bumpVersion(current, bumpArg);

const modeLabel = isDryRun ? " (dry-run)" : skipPublish ? " (git only)" : "";
console.log(`\n  ${current} → ${next}${modeLabel}\n`);

// Idempotency guard
if (checkIdempotency(next)) {
  console.log(`  Already at v${next} with a release commit. Nothing to do.`);
  process.exit(0);
}

// Step 1: version sync (all package.json + integration metadata)
console.log("  Step 1: version sync");
updatePackageJsons(next);

// Step 2: validate + promote CHANGELOG, update ROADMAP header
console.log("  Step 2: validate CHANGELOG.md");
validateChangelog(next);
console.log("  Step 2b: promote [Unreleased] → [" + next + "] + update ROADMAP header");
promoteChangelog(next);
updateRoadmapHeader(next);

// Release blockers that should run before artifact assembly/publish.
console.log("  Step 2c: repository validation");
runValidationScripts();

// Post-version-sync: run assemble.ts to build integration artifacts + checksums
console.log("  Step 3: assemble integration artifacts");
runAssemble(next);

if (isDryRun) {
  console.log("\n  Dry-run complete. Version sync + assemble + validation passed.");
  console.log("  No commit, tag, push, or publish performed.\n");
  process.exit(0);
}

// Step 3: local commit
console.log("  Step 4: git commit (local)");
const filesToAdd = [...ALL_VERSIONED, CHANGELOG_PATH];
if (existsSync(ROADMAP_PATH)) filesToAdd.push(ROADMAP_PATH);
run(["git", "add", ...filesToAdd]);
run(["git", "commit", "-m", `release: v${next}`]);

if (!skipPublish) {
  // Step 4: npm publish
  console.log("\n  Step 5: npm publish packages/cli\n");
  run(["npm", "publish", "--access", "public"], { cwd: CLI_PACKAGE_DIR });
}

// Step 5: git push main
console.log("\n  Step 6: git push origin main\n");
run(["git", "push", "origin", "main"]);

// Steps 6-7: tag + push tag
console.log(`\n  Step 7: git tag v${next}\n`);
run(["git", "tag", `v${next}`]);

console.log(`\n  Step 8: git push origin v${next}\n`);
run(["git", "push", "origin", `v${next}`]);

console.log(`\n  v${next} released\n`);
