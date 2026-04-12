import { existsSync, readFileSync } from "fs";
import { join, dirname, resolve } from "path";

export type UnixEndpointDescriptor = {
  schema: 1;
  transport: "unix";
  path: string;
  pid?: number;
  projectRoot: string;
};

export type TcpEndpointDescriptor = {
  schema: 1;
  transport: "tcp";
  host: string;
  port: number;
  token: string;
  pid?: number;
  projectRoot: string;
};

export type EndpointDescriptor = UnixEndpointDescriptor | TcpEndpointDescriptor;

/**
 * Unity 프로젝트 루트를 찾는다.
 * ProjectSettings/ProjectVersion.txt 파일 존재 여부로 감지.
 */
export function findProjectRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  const root = dirname(dir);

  while (dir !== root) {
    if (existsSync(join(dir, "ProjectSettings", "ProjectVersion.txt"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 루트 디렉토리도 확인
  if (existsSync(join(dir, "ProjectSettings", "ProjectVersion.txt"))) {
    return dir;
  }

  return null;
}

/**
 * 프로젝트 기준 unictl 관련 경로를 반환한다.
 */
export function getProjectPaths(projectPath?: string): {
  projectRoot: string;
  unictlDir: string;
  endpointPath: string;
  legacySocketPath: string;
} {
  const projectRoot = projectPath
    ? resolve(projectPath)
    : findProjectRoot();

  if (!projectRoot) {
    throw new Error(
      "Unity project not found (no ProjectSettings/ProjectVersion.txt in parent directories)\n" +
      "Hint: run from project directory or use --project <path>"
    );
  }

  const unictlDir = join(projectRoot, ".unictl");
  return {
    projectRoot,
    unictlDir,
    endpointPath: join(unictlDir, "endpoint.json"),
    legacySocketPath: join(unictlDir, "unictl.sock"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseEndpointDescriptor(
  value: unknown,
  fallbackProjectRoot: string
): EndpointDescriptor | null {
  if (!isRecord(value)) return null;

  const schema = value.schema;
  const transport = value.transport;
  const projectRoot =
    typeof value.projectRoot === "string" && value.projectRoot.length > 0
      ? value.projectRoot
      : fallbackProjectRoot;
  const pid = typeof value.pid === "number" ? value.pid : undefined;

  if (schema !== 1) return null;

  if (transport === "unix" && typeof value.path === "string" && value.path.length > 0) {
    return {
      schema: 1,
      transport: "unix",
      path: value.path,
      pid,
      projectRoot,
    };
  }

  if (
    transport === "tcp" &&
    typeof value.host === "string" &&
    value.host.length > 0 &&
    typeof value.port === "number" &&
    Number.isFinite(value.port) &&
    typeof value.token === "string" &&
    value.token.length > 0
  ) {
    return {
      schema: 1,
      transport: "tcp",
      host: value.host,
      port: value.port,
      token: value.token,
      pid,
      projectRoot,
    };
  }

  return null;
}

export function hasEndpointFile(projectPath?: string): boolean {
  const { endpointPath } = getProjectPaths(projectPath);
  return existsSync(endpointPath);
}

export function getDefaultUnixEndpoint(projectPath?: string): UnixEndpointDescriptor {
  const { legacySocketPath, projectRoot } = getProjectPaths(projectPath);
  return {
    schema: 1,
    transport: "unix",
    path: legacySocketPath,
    projectRoot,
  };
}

export function readEndpointDescriptor(projectPath?: string): EndpointDescriptor | null {
  const { endpointPath, projectRoot } = getProjectPaths(projectPath);
  if (!existsSync(endpointPath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(endpointPath, "utf-8"));
    return parseEndpointDescriptor(parsed, projectRoot);
  } catch {
    return null;
  }
}

export function resolveEndpointDescriptor(projectPath?: string): EndpointDescriptor {
  return readEndpointDescriptor(projectPath) ?? getDefaultUnixEndpoint(projectPath);
}

export function endpointSeemsPresent(endpoint: EndpointDescriptor): boolean {
  if (endpoint.transport === "unix") {
    return existsSync(endpoint.path);
  }

  return true;
}

function mergeHeaders(
  headers: HeadersInit | undefined,
  extra: Record<string, string>
): Record<string, string> {
  const merged = new Headers(headers);
  for (const [key, value] of Object.entries(extra)) {
    merged.set(key, value);
  }
  return Object.fromEntries(merged.entries());
}

export async function fetchEndpoint(
  endpoint: EndpointDescriptor,
  pathname: string,
  init?: RequestInit
): Promise<Response> {
  if (endpoint.transport === "unix") {
    return fetch(`http://localhost${pathname}`, {
      ...init,
      unix: endpoint.path,
    } as any);
  }

  return fetch(`http://${endpoint.host}:${endpoint.port}${pathname}`, {
    ...init,
    headers: mergeHeaders(init?.headers, {
      "X-Unictl-Token": endpoint.token,
    }),
  });
}

/**
 * 레거시 소켓 경로를 반환한다 (소켓 존재 여부 확인 없음).
 * --project 플래그가 있으면 해당 경로, 없으면 자동 탐색.
 */
export function getSocketPathRaw(projectPath?: string): { sockPath: string; projectRoot: string } {
  const { legacySocketPath, projectRoot } = getProjectPaths(projectPath);
  return { sockPath: legacySocketPath, projectRoot };
}

/**
 * 소켓 경로를 반환한다.
 * --project 플래그가 있으면 해당 경로, 없으면 자동 탐색.
 */
export function getSocketPath(projectPath?: string): string {
  const endpoint = resolveEndpointDescriptor(projectPath);

  if (endpoint.transport !== "unix") {
    throw new Error(
      `Endpoint transport '${endpoint.transport}' does not expose a unix socket path`
    );
  }

  if (!existsSync(endpoint.path)) {
    throw new Error(
      `Unity editor not running (socket not found: ${endpoint.path})\n` +
      "Hint: open the Unity project first"
    );
  }

  return endpoint.path;
}
