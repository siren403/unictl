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
  kind: "json-version" | "json-unictl-version" | "csharp-const";
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

export function readVersion(): string {
  const pkgPath = join(repoRoot, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version: string };
  return pkg.version;
}

export function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

export function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

export function getVersionTargets(): VersionTarget[] {
  return [
    { name: "root-package",          path: join(repoRoot, "package.json"), kind: "json-version" },
    { name: "cli-package",           path: join(repoRoot, "packages", "cli", "package.json"), kind: "json-version" },
    { name: "upm-editor-package",    path: join(repoRoot, "packages", "upm", "com.unictl.editor", "package.json"), kind: "json-version" },
    { name: "codex-plugin-config",   path: join(repoRoot, "integrations", "codex", "plugin.config.json"), kind: "json-version" },
    { name: "claude-support-config", path: join(repoRoot, "integrations", "claude-code", "support-pack.json"), kind: "json-version" },
    { name: "cli-capabilities",      path: join(repoRoot, "packages", "cli", "src", "capabilities.json"), kind: "json-unictl-version" },
    { name: "upm-version-const",     path: join(repoRoot, "packages", "upm", "com.unictl.editor", "Editor", "Unictl", "Internal", "UnictlVersion.cs"), kind: "csharp-const" },
  ];
}

function readCSharpPackageVersion(path: string): string | null {
  const content = readFileSync(path, "utf-8");
  return content.match(/PackageVersion\s*=\s*"([^"]+)"/)?.[1] ?? null;
}

function writeCSharpPackageVersion(path: string, version: string): void {
  const content = readFileSync(path, "utf-8");
  const updated = content.replace(
    /(PackageVersion\s*=\s*")[^"]+(")/,
    `$1${version}$2`,
  );
  if (updated === content) {
    throw new Error(`Could not update PackageVersion const in ${path}`);
  }
  writeFileSync(path, updated, "utf-8");
}

function readVersionTarget(target: VersionTarget): string | null {
  if (target.kind === "csharp-const") return readCSharpPackageVersion(target.path);
  const json = readJsonFile<VersionedJson>(target.path);
  const field = target.kind === "json-unictl-version" ? "unictl_version" : "version";
  const value = json[field];
  return typeof value === "string" ? value : null;
}

export function syncVersionTarget(target: VersionTarget, version: string): { changed: boolean; previous: string | null } {
  const previous = readVersionTarget(target);
  if (previous === version) {
    return { changed: false, previous };
  }

  if (target.kind === "csharp-const") {
    writeCSharpPackageVersion(target.path, version);
  } else {
    const json = readJsonFile<VersionedJson>(target.path);
    const field = target.kind === "json-unictl-version" ? "unictl_version" : "version";
    writeJsonFile(target.path, {
      ...json,
      [field]: version,
    });
  }
  return { changed: true, previous };
}

export function syncVersionField(path: string, version: string): { changed: boolean; previous: string | null } {
  return syncVersionTarget({ name: path, path, kind: "json-version" }, version);
}

export function collectVersionDrift(version: string): Array<{
  name: string;
  path: string;
  expected: string;
  actual: string | null;
}> {
  return getVersionTargets()
    .map((target) => {
      const actual = readVersionTarget(target);
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
