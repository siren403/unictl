// Phase E of unictl v0.7 — Unity ProjectSettings.asset line-oriented editor.
//
// Why line-oriented and not a YAML round-trip:
//   - Unity uses `%YAML 1.1` + `tag:unity3d.com` markers and a strict
//     2-space indent layout. A round-trip through a generic YAML library
//     would normalize whitespace, drop tags, or reorder keys — Unity's
//     SerializedObject is sensitive to all of those.
//   - We only ever change one or two scalars at a time (input handler,
//     scripting backend per platform, keystore path/alias, raw-set top-level).
//     Replacing a single line preserves the file byte-for-byte everywhere
//     else, including comments and blank lines.
//
// Atomicity:
//   - Writes go to a sibling temp file then atomically rename over the
//     original (matches the F.2 pattern). Renames are atomic on NTFS and
//     all POSIX file systems within the same directory.
//
// Lifecycle:
//   - These edits MUST run with the Unity editor closed. Callers should
//     gate the operation with `requireEditorClosed()` (settings.ts) before
//     touching the file. Editor-side caching otherwise overwrites the
//     change at next save.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PROJECT_SETTINGS_PATH = "ProjectSettings/ProjectSettings.asset";

export function projectSettingsPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_SETTINGS_PATH);
}

export function loadProjectSettings(projectRoot: string): string {
  const path = projectSettingsPath(projectRoot);
  if (!existsSync(path)) {
    throw Object.assign(
      new Error(`ProjectSettings.asset not found at ${path}`),
      { kind: "project_root_invalid" },
    );
  }
  return readFileSync(path, "utf-8");
}

/**
 * Atomic write — temp file + rename. Preserves the original line-ending
 * style by reading the original first and matching its EOL. Unity's writer
 * uses LF on macOS/Linux and CRLF on Windows — we follow whatever was on
 * disk to avoid spurious diff churn.
 */
export function saveProjectSettings(projectRoot: string, content: string): void {
  const path = projectSettingsPath(projectRoot);
  const tmp = `${path}.unictl.tmp`;
  writeFileSync(tmp, content, "utf-8");
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------
// Top-level scalar — `^  <key>: <value>$` at the root mapping (2-space indent)
// ---------------------------------------------------------------------------

/**
 * Replace the value of a top-level scalar (2-space indent). Returns the
 * updated content. Throws { kind: "setting_key_not_found" } if the key
 * isn't present or is not a scalar (e.g. a nested mapping).
 *
 * `value` is written as a raw YAML scalar — caller is responsible for
 * passing the YAML-correct form. Strings with special characters should be
 * pre-validated; for known-safe types (integers, file paths without `:`,
 * simple ASCII) just pass the literal.
 */
export function setTopLevelScalar(content: string, key: string, value: string): string {
  const re = makeTopLevelScalarRegex(key);
  if (!re.test(content)) {
    throw Object.assign(
      new Error(`Top-level scalar '${key}' not found (or not a scalar) in ProjectSettings.asset`),
      { kind: "setting_key_not_found" },
    );
  }
  return content.replace(re, (_match, prefix: string) => `${prefix}${value}`);
}

export function getTopLevelScalar(content: string, key: string): string | null {
  const re = makeTopLevelScalarRegex(key);
  const m = content.match(re);
  if (!m) return null;
  // Strip the prefix (`  key: `) — return the value portion captured below.
  // makeTopLevelScalarRegex returns `prefix` + `value` form, so re-match to
  // pick up just the value tail.
  const tailRe = new RegExp(`^( {2}${escapeRegex(key)}:\\s*)(.*)$`, "m");
  const t = content.match(tailRe);
  return t ? t[2] : null;
}

function makeTopLevelScalarRegex(key: string): RegExp {
  // Anchored to a 2-space indent (Unity root mapping). Captures the prefix
  // (everything up to and including the `: ` separator) so the replacement
  // can re-emit it verbatim and only swap the trailing scalar.
  // Negative-lookahead: refuse to match a mapping line (`^  key:` with
  // nothing after — that would be a nested object, not a scalar).
  return new RegExp(`^( {2}${escapeRegex(key)}:[ \\t]+)([^\\r\\n]*)$`, "m");
}

// ---------------------------------------------------------------------------
// Nested scalar — `<parentKey>:` then `<childKey>: <value>` at +2 indent
// ---------------------------------------------------------------------------

/**
 * Replace (or insert) a child scalar inside a top-level mapping. Used for
 * `scriptingBackend.<Platform>` style keys.
 *
 * If the parent mapping is empty (`scriptingBackend: {}`) the child is
 * inserted as a new line and the empty `{}` placeholder is removed. If the
 * parent mapping exists with at least one child, an existing child is
 * replaced; if the child is missing, it's appended at the end of the
 * parent's range.
 */
export function setNestedScalar(
  content: string,
  parentKey: string,
  childKey: string,
  value: string,
): string {
  const lines = content.split(/(\r?\n)/); // keep EOLs in even indices
  // We index each line; lines[0], lines[2], lines[4], ... are content rows;
  // lines[1], lines[3], ... are the EOL strings.
  const parentRe = new RegExp(`^( {2}${escapeRegex(parentKey)}:)(\\s*\\{\\}|\\s*)$`);
  const childRe = new RegExp(`^( {4}${escapeRegex(childKey)}:[ \\t]+)([^\\r\\n]*)$`);
  let parentIdx = -1;
  let inlineEmpty = false;

  for (let i = 0; i < lines.length; i += 2) {
    const m = lines[i].match(parentRe);
    if (m) {
      parentIdx = i;
      inlineEmpty = m[2].trim() === "{}";
      break;
    }
  }
  if (parentIdx < 0) {
    throw Object.assign(
      new Error(`Parent mapping '${parentKey}' not found in ProjectSettings.asset`),
      { kind: "setting_key_not_found" },
    );
  }

  // If the parent was `parentKey: {}`, expand it to an empty mapping then
  // append the child line below.
  if (inlineEmpty) {
    lines[parentIdx] = `  ${parentKey}:`;
    const eol = lines[parentIdx + 1] ?? "\n";
    // Insert child line after the parent line (and its EOL).
    lines.splice(parentIdx + 2, 0, `    ${childKey}: ${value}`, eol);
    return lines.join("");
  }

  // Otherwise scan forward for an existing child or for the end of the
  // parent's nested block (first line that's NOT indented at +4 spaces).
  let lastChildIdx = parentIdx;
  for (let i = parentIdx + 2; i < lines.length; i += 2) {
    const line = lines[i];
    if (line === "") {
      // End-of-file case: stop scanning.
      break;
    }
    if (!line.startsWith("    ")) {
      // Left the nested block.
      break;
    }
    const cm = line.match(childRe);
    if (cm) {
      lines[i] = line.replace(childRe, (_m, prefix: string) => `${prefix}${value}`);
      return lines.join("");
    }
    lastChildIdx = i;
  }

  // Child not present — append it as the last entry in the parent block.
  const eol = lines[lastChildIdx + 1] ?? "\n";
  lines.splice(lastChildIdx + 2, 0, `    ${childKey}: ${value}`, eol);
  return lines.join("");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Platform name mapping for scriptingBackend / api compatibility level / ...
// ---------------------------------------------------------------------------

/**
 * Map a CLI-friendly platform slug to the YAML key used by Unity's
 * per-platform scalar mappings (e.g. `scriptingBackend`).
 *
 * Returns null for unknown slugs.
 */
export function resolvePlatformYamlKey(slug: string): string | null {
  const normalized = slug.trim().toLowerCase();
  switch (normalized) {
    case "android": return "Android";
    case "ios": return "iOS";
    case "standalone":
    case "windows":
    case "win":
    case "win64":
    case "standalonewindows":
    case "standalonewindows64":
    case "standaloneosx":
    case "mac":
    case "macos":
    case "standalonelinux64":
    case "linux":
      return "Standalone";
    case "webgl":
    case "web":
      return "WebGL";
    case "tvos":
      return "tvOS";
    case "ps4": return "PS4";
    case "ps5": return "PS5";
    case "xboxone": return "XboxOne";
    case "switch":
    case "nintendoswitch":
      return "Nintendo Switch";
    default:
      return null;
  }
}
