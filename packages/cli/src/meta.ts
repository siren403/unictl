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

/**
 * Walk up from the CLI source directory to find our own `package.json`
 * (identified by name === "unictl"). Works both in dev (tools/unictl/packages/cli)
 * and when installed via npm (node_modules/unictl).
 */
function findOwnPackageJson(from: string): string {
  let dir = resolve(from);

  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = readJsonFile<{ name?: string }>(pkgPath);
      if (pkg.name === "unictl") return pkgPath;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate unictl package.json from ${from}`);
    }
    dir = parent;
  }
}

const cliPackageJsonPath = findOwnPackageJson(runtimeDir);
const cliPackageDir = dirname(cliPackageJsonPath);

export function getCliPackageMeta(): PackageMeta & { packageJsonPath: string } {
  const pkg = readJsonFile<PackageMeta>(cliPackageJsonPath);
  return {
    ...pkg,
    packageJsonPath: cliPackageJsonPath,
  };
}

export function getRepoUrl(): string | null {
  const pkg = readJsonFile<{ repository?: { url?: string } | string }>(cliPackageJsonPath);
  if (!pkg.repository) return null;
  if (typeof pkg.repository === "string") return pkg.repository;
  return pkg.repository.url ?? null;
}

/**
 * Locate the sibling UPM package in a monorepo checkout.
 * Returns null when running from an npm-installed package (UPM isn't shipped
 * in the CLI tarball).
 */
function findSiblingUpmPackage(): string | null {
  // Dev layout: <repo>/packages/cli/package.json + <repo>/packages/upm/com.unictl.editor
  const candidate = join(cliPackageDir, "..", "upm", "com.unictl.editor");
  if (existsSync(join(candidate, "package.json"))) return candidate;
  return null;
}

export function getEmbeddedEditorPackagePath(): string | null {
  return findSiblingUpmPackage();
}

export function getEmbeddedEditorPackageVersion(): string | null {
  const packagePath = findSiblingUpmPackage();
  if (!packagePath) return null;

  const pkg = readJsonFile<PackageMeta>(join(packagePath, "package.json"));
  return pkg.version ?? null;
}
