#!/usr/bin/env bun
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

const repoRoot = join(import.meta.dir, "..");
const validator = join(repoRoot, "scripts", "check-unity-meta-guids.ts");

type Case = {
  name: string;
  files: Record<string, string>;
  shouldPass: boolean;
  expectedText?: string;
};

const cases: Case[] = [
  {
    name: "valid GUIDs pass",
    shouldPass: true,
    files: {
      "A.cs.meta": "fileFormatVersion: 2\nguid: 4f4a1f471f814b33a1d92e048a7a4c1b\n",
      "B.cs.meta": "fileFormatVersion: 2\nguid: 9d408a55312e42a5850c36f7774256fd\n",
    },
  },
  {
    name: "known placeholder fails",
    shouldPass: false,
    expectedText: "known placeholder/sample guid",
    files: {
      "A.cs.meta": "fileFormatVersion: 2\nguid: a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6\n",
    },
  },
  {
    name: "duplicates fail",
    shouldPass: false,
    expectedText: "duplicate guid already used by",
    files: {
      "A.cs.meta": "fileFormatVersion: 2\nguid: 4f4a1f471f814b33a1d92e048a7a4c1b\n",
      "Nested/B.cs.meta": "fileFormatVersion: 2\nguid: 4f4a1f471f814b33a1d92e048a7a4c1b\n",
    },
  },
  {
    name: "sequential-looking GUIDs fail",
    shouldPass: false,
    expectedText: "sequential-looking guid",
    files: {
      "A.cs.meta": "fileFormatVersion: 2\nguid: 0123456789abcdef0011223344556677\n",
    },
  },
];

function writeCase(root: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

for (const testCase of cases) {
  const root = mkdtempSync(join(tmpdir(), "unictl-meta-guid-test-"));
  try {
    writeCase(root, testCase.files);
    const result = Bun.spawnSync(["bun", "run", validator, `--root=${root}`], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;

    if (testCase.shouldPass && result.exitCode !== 0) {
      console.error(`[FAIL] ${testCase.name}: expected pass, got exit ${result.exitCode}`);
      console.error(output);
      process.exit(1);
    }

    if (!testCase.shouldPass && result.exitCode === 0) {
      console.error(`[FAIL] ${testCase.name}: expected failure`);
      console.error(output);
      process.exit(1);
    }

    if (testCase.expectedText && !output.includes(testCase.expectedText)) {
      console.error(`[FAIL] ${testCase.name}: expected output to include '${testCase.expectedText}'`);
      console.error(output);
      process.exit(1);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log("Unity .meta GUID validation regression tests passed.");
