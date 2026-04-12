import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

export type VersionTarget = {
  name: string;
  path: string;
};

type VersionedJson = {
  version?: string;
  [key: string]: unknown;
};

const libDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(libDir, "..", "..");

export function getReleaseRoot(): string {
  return repoRoot;
}

export function getRepoRoot(): string {
  return repoRoot;
}

export function getVersionPath(): string {
  return join(repoRoot, "VERSION");
}

export function readVersion(): string {
  return readFileSync(getVersionPath(), "utf-8").trim();
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function getVersionTargets(): VersionTarget[] {
  return [
    { name: "root-package", path: join(repoRoot, "package.json") },
    { name: "cli-package", path: join(repoRoot, "packages", "cli", "package.json") },
    { name: "upm-core-package", path: join(repoRoot, "packages", "upm", "com.unictl.core", "package.json") },
    { name: "codex-plugin-config", path: join(repoRoot, "integrations", "codex", "plugin.config.json") },
    { name: "claude-support-config", path: join(repoRoot, "integrations", "claude-code", "support-pack.json") },
  ];
}

export function syncVersionField(path: string, version: string): { changed: boolean; previous: string | null } {
  const json = readJsonFile<VersionedJson>(path);
  const previous = typeof json.version === "string" ? json.version : null;
  if (previous === version) {
    return { changed: false, previous };
  }

  writeJsonFile(path, {
    ...json,
    version,
  });
  return { changed: true, previous };
}

export function collectVersionDrift(version: string): Array<{
  name: string;
  path: string;
  expected: string;
  actual: string | null;
}> {
  return getVersionTargets()
    .map((target) => {
      const json = readJsonFile<VersionedJson>(target.path);
      const actual = typeof json.version === "string" ? json.version : null;
      return {
        name: target.name,
        path: target.path,
        expected: version,
        actual,
      };
    })
    .filter((entry) => entry.actual !== entry.expected);
}

export function ensureCleanDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function copyTree(source: string, destination: string): void {
  const stats = statSync(source);
  if (stats.isDirectory()) {
    ensureDir(destination);
    for (const entry of readdirSync(source)) {
      copyTree(join(source, entry), join(destination, entry));
    }
    return;
  }

  ensureDir(dirname(destination));
  copyFileSync(source, destination);
}

export function listRelativeFiles(root: string): string[] {
  const files: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const next = join(current, entry);
      const stats = statSync(next);
      if (stats.isDirectory()) {
        walk(next);
      } else {
        files.push(relative(root, next));
      }
    }
  }

  if (existsSync(root)) {
    walk(root);
  }

  return files.sort();
}

export function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

export function getFileSize(path: string): number {
  return statSync(path).size;
}

export function writeSha256Sums(
  outputPath: string,
  entries: Array<{ fileName: string; absolutePath: string }>
): void {
  const lines = entries.map((entry) => `${sha256File(entry.absolutePath)}  ${entry.fileName}`);
  writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf-8");
}

export function runCheckedCommand(
  command: string[],
  options?: { cwd?: string }
): void {
  const proc = Bun.spawnSync(command, {
    cwd: options?.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (proc.exitCode !== 0) {
    const stderr = proc.stderr.toString().trim();
    const stdout = proc.stdout.toString().trim();
    throw new Error(
      `Command failed: ${command.join(" ")}\n${stderr || stdout || `exitCode=${proc.exitCode}`}`
    );
  }
}
