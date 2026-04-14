import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

type PackageMeta = {
  name: string;
  version: string;
};

const runtimeDir = dirname(fileURLToPath(import.meta.url));

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function findRepoRoot(from: string): string {
  let dir = resolve(from);

  while (true) {
    if (existsSync(join(dir, "package.json")) && existsSync(join(dir, "VERSION"))) {
      return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate unictl repo root from ${from}`);
    }
    dir = parent;
  }
}

const repoRoot = findRepoRoot(runtimeDir);
const rootPackageJsonPath = join(repoRoot, "package.json");
const embeddedEditorPackagePath = join(repoRoot, "packages", "upm", "com.unictl.editor");

export function getCliPackageMeta(): PackageMeta & { packageJsonPath: string } {
  const pkg = readJsonFile<PackageMeta>(rootPackageJsonPath);
  return {
    ...pkg,
    packageJsonPath: rootPackageJsonPath,
  };
}

export function getRepoUrl(): string | null {
  const pkg = readJsonFile<{ repository?: { url?: string } | string }>(rootPackageJsonPath);
  if (!pkg.repository) return null;
  if (typeof pkg.repository === "string") return pkg.repository;
  return pkg.repository.url ?? null;
}

export function getEmbeddedEditorPackagePath(): string {
  return embeddedEditorPackagePath;
}

export function getEmbeddedEditorPackageVersion(): string | null {
  const packagePath = join(embeddedEditorPackagePath, "package.json");
  if (!existsSync(packagePath)) return null;

  const pkg = readJsonFile<PackageMeta>(packagePath);
  return pkg.version ?? null;
}
