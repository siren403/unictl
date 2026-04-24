import { existsSync, renameSync, writeFileSync } from "fs";
import { basename, join, resolve } from "path";
import {
  collectVersionDrift,
  copyTree,
  ensureCleanDir,
  ensureDir,
  getFileSize,
  getReleaseRoot,
  getRepoRoot,
  listRelativeFiles,
  readJsonFile,
  readVersion,
  runCheckedCommand,
  sha256File,
  writeJsonFile,
  writeSha256Sums,
} from "../lib/release";

type CodexPluginConfig = {
  name: string;
  version: string;
  description: string;
  author?: Record<string, unknown>;
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  interface?: Record<string, unknown>;
};

type ClaudeSupportConfig = {
  name: string;
  version: string;
  description: string;
  artifactName: string;
};

type ArtifactEntry = {
  name: string;
  kind: string;
  absolutePath: string;
  sha256: string;
  size: number;
};

function parseOutputDir(): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && i + 1 < args.length) {
      return resolve(args[i + 1]);
    }
  }

  return resolve(getRepoRoot(), ".tmp", "phase-e-release");
}

function buildCodexPlugin(
  outputRoot: string,
  version: string
): { stageDir: string; artifactName: string } {
  const releaseRoot = getReleaseRoot();
  const configPath = join(releaseRoot, "integrations", "codex", "plugin.config.json");
  const sourceRoot = join(releaseRoot, "integrations", "codex");
  const docsRoot = join(releaseRoot, "docs", "standalone");
  const config = readJsonFile<CodexPluginConfig>(configPath);
  const stageDir = join(outputRoot, "staging", `codex-plugin-${version}`);

  ensureCleanDir(stageDir);
  ensureDir(join(stageDir, ".codex-plugin"));
  ensureDir(join(stageDir, "skills"));
  ensureDir(join(stageDir, "docs", "standalone"));

  copyTree(join(sourceRoot, "skills"), join(stageDir, "skills"));
  copyTree(join(sourceRoot, "README.md"), join(stageDir, "README.md"));
  copyTree(docsRoot, join(stageDir, "docs", "standalone"));

  const pluginJson = {
    name: config.name,
    version,
    description: config.description,
    author: config.author,
    homepage: config.homepage,
    repository: config.repository,
    license: config.license,
    keywords: config.keywords ?? [],
    skills: "./skills/",
    interface: config.interface,
  };
  writeJsonFile(join(stageDir, ".codex-plugin", "plugin.json"), pluginJson);

  return {
    stageDir,
    artifactName: `codex-plugin-${version}.zip`,
  };
}

function buildClaudeSupport(
  outputRoot: string,
  version: string
): { stageDir: string; artifactName: string } {
  const releaseRoot = getReleaseRoot();
  const configPath = join(releaseRoot, "integrations", "claude-code", "support-pack.json");
  const sourceRoot = join(releaseRoot, "integrations", "claude-code");
  const docsRoot = join(releaseRoot, "docs", "standalone");
  const config = readJsonFile<ClaudeSupportConfig>(configPath);
  const stageDir = join(outputRoot, "staging", `${config.artifactName}-${version}`);

  ensureCleanDir(stageDir);
  copyTree(join(sourceRoot, ".claude"), join(stageDir, ".claude"));
  copyTree(join(sourceRoot, "README.md"), join(stageDir, "README.md"));
  copyTree(join(sourceRoot, "install.sh"), join(stageDir, "install.sh"));
  copyTree(docsRoot, join(stageDir, "docs", "standalone"));

  const metadata = {
    name: config.name,
    version,
    description: config.description,
    generated_from: sourceRoot,
  };
  writeJsonFile(join(stageDir, "support-pack.json"), metadata);

  return {
    stageDir,
    artifactName: `${config.artifactName}-${version}.zip`,
  };
}

function packZip(stageDir: string, artifactPath: string): void {
  if (process.platform === "win32") {
    // Use PowerShell Compress-Archive on Windows (zip binary not reliably available)
    const sourceDir = join(stageDir, "..");
    const stageName = basename(stageDir);
    runCheckedCommand(
      [
        "pwsh", "-NoProfile", "-Command",
        `Compress-Archive -Path '${join(sourceDir, stageName)}' -DestinationPath '${artifactPath}' -Force`,
      ],
      { cwd: sourceDir }
    );
  } else {
    runCheckedCommand(["zip", "-qr", artifactPath, basename(stageDir)], {
      cwd: join(stageDir, ".."),
    });
  }
}

function packUpm(outputRoot: string, version: string): string {
  const repoRoot = getRepoRoot();
  const packageParent = join(repoRoot, "packages", "upm");
  const artifactName = `com.unictl.editor-${version}.tgz`;
  const artifactPath = join(outputRoot, artifactName);
  // Use a relative output path to avoid Windows drive-letter issues with BSD tar.
  // Write the tgz into packageParent first, then it will be moved to outputRoot below.
  const tempArtifact = join(packageParent, artifactName);
  runCheckedCommand(["tar", "-czf", artifactName, "com.unictl.editor"], {
    cwd: packageParent,
  });
  // Move from packageParent to outputRoot
  renameSync(tempArtifact, artifactPath);
  return artifactPath;
}

function buildArtifactEntries(paths: Array<{ name: string; kind: string; absolutePath: string }>): ArtifactEntry[] {
  return paths.map((entry) => ({
    ...entry,
    sha256: sha256File(entry.absolutePath),
    size: getFileSize(entry.absolutePath),
  }));
}

const outputRoot = parseOutputDir();
const version = readVersion();
const mismatches = collectVersionDrift(version);

if (mismatches.length > 0) {
  console.log(JSON.stringify({
    success: false,
    message: "Release assemble aborted because version drift was detected.",
    data: {
      version,
      mismatches,
    },
  }));
  process.exit(1);
}

ensureCleanDir(outputRoot);
ensureDir(join(outputRoot, "staging"));

const codex = buildCodexPlugin(outputRoot, version);
const claude = buildClaudeSupport(outputRoot, version);

const codexZipPath = join(outputRoot, codex.artifactName);
const claudeZipPath = join(outputRoot, claude.artifactName);
const upmTgzPath = packUpm(outputRoot, version);

packZip(codex.stageDir, codexZipPath);
packZip(claude.stageDir, claudeZipPath);

const artifacts = buildArtifactEntries([
  { name: basename(upmTgzPath), kind: "upm-package", absolutePath: upmTgzPath },
  { name: basename(codexZipPath), kind: "codex-plugin", absolutePath: codexZipPath },
  { name: basename(claudeZipPath), kind: "claude-support-pack", absolutePath: claudeZipPath },
]);

const manifestPath = join(outputRoot, "release-manifest.json");
writeJsonFile(manifestPath, {
  schema: 1,
  product: "unictl",
  version,
  embedded_release_root: getReleaseRoot(),
  generated_at: new Date().toISOString(),
  shared_docs_source: join(getReleaseRoot(), "docs", "standalone"),
  shared_docs_files: listRelativeFiles(join(getReleaseRoot(), "docs", "standalone")),
  artifacts,
  planned_future_assets: [
    "unictl_native-macos-x64-or-universal.tar.gz",
    "unictl_native-windows-x64.zip",
  ],
});

const checksumPath = join(outputRoot, "SHA256SUMS");
writeSha256Sums(checksumPath, [
  ...artifacts.map((artifact) => ({ fileName: artifact.name, absolutePath: artifact.absolutePath })),
  { fileName: "release-manifest.json", absolutePath: manifestPath },
]);

const result = {
  success: true,
  message: "Release skeleton assembled.",
  data: {
    output_root: outputRoot,
    version,
    artifacts,
    checksums_path: checksumPath,
    manifest_path: manifestPath,
    staging_dirs: [codex.stageDir, claude.stageDir],
    smoke_notes: [
      "Integration wrappers are thin packs generated from docs/standalone source.",
      "Native standalone artifacts remain planned until the Windows finalization phase.",
    ],
  },
};

console.log(JSON.stringify(result));
