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
const embeddedCorePackagePath = join(repoRoot, "packages", "upm", "com.unictl.core");

export function getCliPackageMeta(): PackageMeta & { packageJsonPath: string } {
  const pkg = readJsonFile<PackageMeta>(rootPackageJsonPath);
  return {
    ...pkg,
    packageJsonPath: rootPackageJsonPath,
  };
}

export function getEmbeddedCorePackagePath(): string {
  return embeddedCorePackagePath;
}

export function getEmbeddedCorePackageVersion(): string | null {
  const packagePath = join(embeddedCorePackagePath, "package.json");
  if (!existsSync(packagePath)) return null;

  const pkg = readJsonFile<PackageMeta>(packagePath);
  return pkg.version ?? null;
}
