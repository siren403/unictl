// Phase E of unictl v0.7 — settings lifecycle helpers.
//
// Cross-cutting glue for the four E sub-PRs:
//   - input set / scripting set / settings raw-set: editor-closed YAML edits
//   - deploy android keystore set: same + secret stdin handling
//
// All four refuse to run while the editor is up (Unity caches PlayerSettings
// in memory and writes them back on save, silently overwriting our edit).
// `--restart` on input set uses the editor quit lifecycle first, then proceeds.

import { findProjectRoot } from "./socket";
import { getRuntimeStatus } from "./runtime";
import { errorEnvelope } from "./error";
import { editorQuit } from "./editor";

export type Preflight =
  | { ok: true; projectRoot: string }
  | { ok: false; envelope: ReturnType<typeof errorEnvelope> & { error: { exit_code: number } } };

/**
 * Resolve project root + ensure editor is closed before mutating
 * ProjectSettings.asset. If `--restart` was passed, attempt a graceful
 * editor quit lifecycle first; if the editor stays alive, surface the error.
 *
 * Use this from every Phase E command BEFORE any file write.
 */
export async function requireEditorClosed(opts: {
  project?: string;
  restart?: boolean;
  intent: string;
}): Promise<Preflight> {
  const projectRoot = findProjectRoot(opts.project);
  if (!projectRoot) {
    const env = errorEnvelope({
      kind: "project_root_invalid",
      message: "Could not resolve a Unity project root from the given --project path or cwd.",
      recovery: "Run from a Unity project directory or pass --project <path-to-project-root>.",
      related: ["doctor"],
      context: { intent: opts.intent },
    });
    return { ok: false, envelope: { ...env, error: { ...env.error, exit_code: 2 } } };
  }

  const runtime = getRuntimeStatus(projectRoot);
  const editorAlive = runtime.status === "alive" || runtime.status === "pid_mismatch";

  if (editorAlive) {
    if (opts.restart) {
      try {
        await editorQuit({ project: projectRoot, gracefulTimeoutMs: 30_000 });
      } catch {
        // Quit failure is non-fatal here — fall through to the post-quit
        // liveness check so callers get the standard editor_running envelope.
      }

      const post = getRuntimeStatus(projectRoot);
      if (post.status === "alive" || post.status === "pid_mismatch") {
        const env = errorEnvelope({
          kind: "editor_running",
          message: `Editor is still running after --restart quit attempt; cannot modify ProjectSettings.asset for '${opts.intent}'.`,
          recovery: "Close the editor manually, then re-run.",
          related: ["editor.quit", "editor.status"],
          context: { intent: opts.intent, post_status: post.status },
        });
        return { ok: false, envelope: { ...env, error: { ...env.error, exit_code: 3 } } };
      }
    } else {
      const env = errorEnvelope({
        kind: "editor_running",
        message: `Editor is running; cannot modify ProjectSettings.asset for '${opts.intent}' while it is open.`,
        recovery: "Close the editor and re-run, or pass --restart to auto-quit it.",
        related: ["editor.quit", "wait"],
        context: { intent: opts.intent, runtime_status: runtime.status },
      });
      return { ok: false, envelope: { ...env, error: { ...env.error, exit_code: 3 } } };
    }
  }

  return { ok: true, projectRoot };
}

// ---------------------------------------------------------------------------
// Secret stdin handling — keystore / key passwords
// ---------------------------------------------------------------------------

const ETX = 0x03; // Ctrl+C
const BS = 0x08; // Backspace
const LF = 0x0a;
const CR = 0x0d;
const DEL = 0x7f; // Delete (most TTYs send this for Backspace key)

// Cached lines from a piped stdin so multiple readSecretFromStdin() calls in
// the same process can each pull the next line. The cache is filled on the
// first call from a non-TTY stdin (CI / `printf "a\nb\n" | unictl ...`).
let pipedLines: string[] | null = null;

async function readAllPipedLines(): Promise<string[]> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (c) => chunks.push(c as Buffer));
    process.stdin.once("end", () => {
      if (chunks.length === 0) {
        resolve([]);
        return;
      }
      const all = Buffer.concat(chunks).toString("utf-8");
      // Split on LF / CRLF; keep empty trailing line out of the queue.
      const parts = all.split(/\r?\n/);
      if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
      resolve(parts);
    });
    process.stdin.resume();
  });
}

/**
 * Read a single password line from stdin without echoing.
 *
 * Behavior:
 *   - If stdin is a TTY: enable raw mode, read until LF, restore.
 *   - If stdin is a pipe (CI / `printf "a\nb\n" | unictl ...`): the entire
 *     pipe is read on the first call, queued, and each subsequent call
 *     pulls the next line. This lets keystore + key passwords share one
 *     piped stdin.
 *
 * Returns null if no input is available (TTY closed without input, Ctrl+C,
 * or piped stdin queue exhausted).
 */
export async function readSecretFromStdin(prompt: string): Promise<string | null> {
  const stdin = process.stdin;

  if (stdin.isTTY) {
    process.stderr.write(prompt);
    return new Promise<string | null>((resolve) => {
      const chunks: string[] = [];
      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding("utf-8");

      const onData = (chunk: string) => {
        for (const ch of chunk) {
          const code = ch.charCodeAt(0);
          if (code === ETX) {
            cleanup();
            process.stderr.write("\n");
            resolve(null);
            return;
          }
          if (code === LF || code === CR) {
            cleanup();
            process.stderr.write("\n");
            resolve(chunks.join(""));
            return;
          }
          if (code === BS || code === DEL) {
            chunks.pop();
            continue;
          }
          chunks.push(ch);
        }
      };

      const cleanup = () => {
        stdin.setRawMode(false);
        stdin.removeListener("data", onData);
        stdin.pause();
      };

      stdin.on("data", onData);
    });
  }

  if (pipedLines === null) {
    pipedLines = await readAllPipedLines();
  }
  if (pipedLines.length === 0) return null;
  return pipedLines.shift() ?? null;
}

/**
 * Redact a secret for logging. Returns a fixed-width mask so output sizes
 * don't leak the secret length.
 */
export function redact(_value: string | null | undefined): string {
  return "********";
}
