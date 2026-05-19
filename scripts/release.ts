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
 *   3. git add -A + commit "release: v<ver>"  (local only)
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
import { getVersionTargets, syncVersionTarget } from "./lib/release";

const ROOT = join(import.meta.dir, "..");

const CLI_PACKAGE_DIR = join(ROOT, "packages/cli");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const ROADMAP_PATH   = join(ROOT, "docs/standalone/ROADMAP.md");

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
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
  for (const target of getVersionTargets()) {
    syncVersionTarget(target, version);
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

function gitOutput(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    console.error(result.stderr.toString());
    console.error(`\n  Failed: git ${args.join(" ")}\n`);
    process.exit(1);
  }
  return result.stdout.toString();
}

function assertCleanWorkingTree(context: string): void {
  const status = gitOutput(["status", "--porcelain"]);
  if (status.trim().length > 0) {
    console.error(`\n  ERROR: working tree is not clean ${context}.`);
    console.error("  Dirty paths:");
    console.error(status);
    console.error("  The release commit, npm publish, and git tag must all refer to the same source state.\n");
    process.exit(1);
  }
}

function assertStagedChanges(): void {
  const staged = gitOutput(["diff", "--cached", "--name-only"]);
  if (staged.trim().length === 0) {
    console.error("\n  ERROR: release produced no staged changes to commit.\n");
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
  run(["bun", "run", "scripts/version/drift-check.ts"]);
  run(["bun", "run", "scripts/check-error-registry.ts"]);
  run(["bun", "run", "scripts/check-unity-meta-guids.ts"]);
}

// ---------------------------------------------------------------------------
// Native bridge build + freshness assertion
// ---------------------------------------------------------------------------
//
// History: v0.7.0 / v0.7.1 shipped with a stale Apr-13 DLL because the release
// pipeline never rebuilt the native bridge before assembling the UPM tarball.
// The /liveness route added in Phase A landed in Rust source but the bundled
// DLL didn't carry it, so consumer installs returned `not_found` for every
// liveness/wait call. v0.7.2 adds:
//
//   1. A platform-specific build step that always runs before assemble.
//   2. A freshness assertion that fails fast if any committed native binary
//      under packages/upm/com.unictl.editor/Plugins is older than the latest
//      Rust source file. This catches missed rebuilds on other platforms
//      (e.g. macOS .dylib left untouched while Windows DLL was rebuilt).
//
// Cross-platform note: the current release host can only rebuild ITS OWN
// platform binary (Windows host → DLL only; macOS host → dylib only). Binaries
// for other platforms must be committed by whoever last released from that
// platform. The freshness check below catches the gap.

import { readdirSync, statSync } from "fs";

const NATIVE_SRC_DIR  = join(ROOT, "native/unictl_native/src");
const NATIVE_CARGO    = join(ROOT, "native/unictl_native/Cargo.toml");
const UPM_PLUGIN_DIR  = join(ROOT, "packages/upm/com.unictl.editor/Plugins");

const NATIVE_BUILD_BY_PLATFORM: Record<string, string[]> = {
  win32:  ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build/build-native-windows.ps1"],
  darwin: ["bash", "scripts/build/build-native-macos.sh"],
};

function walkFiles(dir: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(p, predicate));
    } else if (predicate(ent.name)) {
      out.push(p);
    }
  }
  return out;
}

function latestMtimeMs(files: string[]): number {
  let latest = 0;
  for (const f of files) {
    const m = statSync(f).mtimeMs;
    if (m > latest) latest = m;
  }
  return latest;
}

function buildNativeAndAssertFreshness(): void {
  const platform = process.platform;
  const buildCmd = NATIVE_BUILD_BY_PLATFORM[platform];

  if (buildCmd) {
    console.log(`  Step 0: build native bridge (${platform})`);
    run(buildCmd);
  } else {
    console.warn(`  Step 0: no native build script for platform '${platform}'; skipping rebuild`);
    console.warn(`         freshness assertion below still runs.`);
  }

  const sources = [
    ...walkFiles(NATIVE_SRC_DIR, (n) => n.endsWith(".rs")),
    NATIVE_CARGO,
  ].filter(existsSync);
  const srcMtime = latestMtimeMs(sources);

  const binaries = walkFiles(UPM_PLUGIN_DIR, (n) => /\.(dll|dylib|so)$/i.test(n));
  if (binaries.length === 0) {
    console.error("\n  ERROR: no native binaries found under packages/upm/com.unictl.editor/Plugins/");
    console.error("  The UPM tarball would ship without a native bridge.\n");
    process.exit(1);
  }

  const stale: string[] = [];
  for (const bin of binaries) {
    const m = statSync(bin).mtimeMs;
    if (m < srcMtime) stale.push(bin);
  }
  if (stale.length > 0) {
    console.error("\n  ERROR: stale native binaries detected (older than newest Rust source):");
    for (const f of stale) {
      const m = new Date(statSync(f).mtimeMs).toISOString();
      console.error(`    ${f}  (${m})`);
    }
    console.error(`  Newest source mtime: ${new Date(srcMtime).toISOString()}`);
    console.error(`  Rebuild on the host that owns each platform's binary, then re-run release.\n`);
    process.exit(1);
  }
  console.log(`  Native binaries OK (${binaries.length} file(s), newest source ${new Date(srcMtime).toISOString()})`);
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

// Native bridge build + freshness assertion. v0.7.0/0.7.1 shipped stale DLLs
// because the pipeline never rebuilt before assemble; this step closes that gap.
buildNativeAndAssertFreshness();

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
run(["git", "add", "-A"]);
assertStagedChanges();
run(["git", "commit", "-m", `release: v${next}`]);
assertCleanWorkingTree("after creating the release commit");

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
