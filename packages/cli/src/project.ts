import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { getProjectPaths } from "./socket";

export type UnityManifest = {
  dependencies?: Record<string, string>;
  scopedRegistries?: unknown[];
  [key: string]: unknown;
};

export type ParsedPackageReference = {
  kind: "git-tag" | "file" | "opaque";
  source: string;
  version: string | null;
  resolvedPath?: string;
};

export function getManifestPath(projectPath?: string): string {
  const { projectRoot } = getProjectPaths(projectPath);
  return join(projectRoot, "Packages", "manifest.json");
}

export function readProjectManifest(projectPath?: string): UnityManifest {
  const manifestPath = getManifestPath(projectPath);
  if (!existsSync(manifestPath)) {
    throw new Error(`Unity manifest not found: ${manifestPath}`);
  }

  return JSON.parse(readFileSync(manifestPath, "utf-8")) as UnityManifest;
}

export function writeProjectManifest(projectPath: string | undefined, manifest: UnityManifest): string {
  const manifestPath = getManifestPath(projectPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  return manifestPath;
}

export function buildGitPackageReference(repoUrl: string, version?: string): string {
  const normalizedRepoUrl = repoUrl.endsWith(".git") ? repoUrl : `${repoUrl}.git`;
  const fragment = version ? `#v${version}` : "";
  return `${normalizedRepoUrl}?path=/packages/upm/com.unictl.editor${fragment}`;
}


function tryReadPackageVersion(packagePath: string): string | null {
  const packageJsonPath = join(packagePath, "package.json");
  if (!existsSync(packageJsonPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export function parsePackageReference(
  reference: string,
  projectPath?: string
): ParsedPackageReference {
  const gitTagMatch = reference.match(/#v([^#?]+)$/);
  if (gitTagMatch) {
    return {
      kind: "git-tag",
      source: reference,
      version: gitTagMatch[1],
    };
  }

  if (reference.startsWith("file:")) {
    const rawPath = reference.slice(5);
    const manifestPath = getManifestPath(projectPath);
    const resolvedPath = rawPath.startsWith("/")
      ? rawPath
      : resolve(manifestPath, "..", rawPath);
    return {
      kind: "file",
      source: reference,
      version: tryReadPackageVersion(resolvedPath),
      resolvedPath,
    };
  }

  return {
    kind: "opaque",
    source: reference,
    version: null,
  };
}
