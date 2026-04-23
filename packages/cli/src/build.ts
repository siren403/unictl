import { defineCommand } from "citty";
import { mkdirSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// Library/unictl-builds helpers
// ---------------------------------------------------------------------------

/** Returns the canonical builds directory for a project root. */
export function getBuildsDir(projectRoot: string): string {
  return join(projectRoot, "Library", "unictl-builds");
}

/** Ensures the builds directory exists (mkdir -p). */
export function ensureBuildsDir(projectRoot: string): void {
  mkdirSync(getBuildsDir(projectRoot), { recursive: true });
}

// ---------------------------------------------------------------------------
// build subcommand — P1 scaffold stub
// ---------------------------------------------------------------------------

export const buildCmd = defineCommand({
  meta: {
    name: "build",
    description: `Build a Unity player (auto-routes between live editor via IPC and headless batchmode).

QUICK START:
  unictl build --target StandaloneWindows64 --wait
  unictl build --target Android --build-profile Assets/Profiles/Android-Release.asset --timeout 3600
  unictl build --target iOS --batch --output Build/iOS --job-id ci-abc123

LANE ROUTING:
  editor running + low hook_risk    → IPC lane (fast path)
  editor running + hook_risk=high   → Batchmode (unless --force-ipc)
  editor not running                → Batchmode lane
  multiple editors                  → fail-fast (multi_instance)
  stale UnityLockfile               → preflight error (project_locked)

EXIT CODES:
  0   success
  1   build failed
  2   param/validation error
  3   lane unavailable (editor_busy / project_locked / multi_instance)
  124 --wait client timeout while build continues
  125 unictl internal error`,
  },
  args: {
    target: { type: "string", description: "Unity BuildTarget (e.g. StandaloneWindows64, Android, iOS, WebGL)" },
    output: { type: "string", description: "Output path (default: derived from target + ProductName)" },
    scenes: { type: "string", description: "Comma-separated scene paths (default: EditorBuildSettings)" },
    define: { type: "string", description: "Comma-separated define symbols (e.g. DEBUG,API_URL=https://...)" },
    buildProfile: { type: "string", description: "Unity 6+ BuildProfile asset path" },
    development: { type: "boolean", default: false, description: "Development build" },
    allowDebugging: { type: "boolean", default: false, description: "Allow script debugging" },
    wait: { type: "boolean", default: true, description: "Block until terminal state (default: on)" },
    timeout: { type: "string", default: "0", description: "Client wait timeout in seconds (0 = unlimited)" },
    batch: { type: "boolean", default: false, description: "Force batchmode lane (errors if editor running)" },
    forceIpc: { type: "boolean", default: false, description: "Override hook_risk=high auto-fallback" },
    jobId: { type: "string", description: "Override auto-generated job_id" },
    project: { type: "string", description: "Unity project path (auto-detected if omitted)" },
  },
  run: async (_ctx) => {
    // P1 stub — real routing lands in P2a
    console.log(JSON.stringify({
      ok: false,
      error: {
        kind: "not_yet_implemented",
        message: "unictl build is scaffolded in P1; actual routing lands in P2a.1.",
        hint: "For now, use: unictl command build_project (returns usage envelope)",
      },
    }));
    process.exit(125);
  },
});
