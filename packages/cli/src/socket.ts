import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { connect } from "net";
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

export type PipeEndpointDescriptor = {
  schema: 1;
  transport: "pipe";
  pipeName: string;
  pid?: number;
  projectRoot: string;
};

export type EndpointDescriptor = UnixEndpointDescriptor | TcpEndpointDescriptor | PipeEndpointDescriptor;

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
    legacySocketPath: join(unictlDir, "unictl.sock"),
  };
}


/** @deprecated endpoint.json is no longer written on Windows. Kept for macOS legacy compatibility. */
export function hasEndpointFile(projectPath?: string): boolean {
  const { unictlDir } = getProjectPaths(projectPath);
  return existsSync(join(unictlDir, "endpoint.json"));
}

/** @deprecated endpoint.json is no longer written on Windows. Kept for macOS legacy compatibility. */
export function readEndpointDescriptor(projectPath?: string): EndpointDescriptor | null {
  const { unictlDir, projectRoot } = getProjectPaths(projectPath);
  const endpointPath = join(unictlDir, "endpoint.json");
  if (!existsSync(endpointPath)) return null;

  try {
    const value = JSON.parse(readFileSync(endpointPath, "utf-8"));
    if (typeof value !== "object" || value === null || value.schema !== 1) return null;

    if (value.transport === "unix" && typeof value.path === "string" && value.path.length > 0) {
      return { schema: 1, transport: "unix", path: value.path, pid: value.pid, projectRoot: value.projectRoot ?? projectRoot };
    }

    return null;
  } catch {
    return null;
  }
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

export function computePipeName(projectRoot: string): string {
  const normalized = projectRoot.replace(/\\/g, "/");
  const hash = createHash("sha256").update(normalized, "utf-8").digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\unictl-${hash}`;
}

export function getDefaultPipeEndpoint(projectPath?: string): PipeEndpointDescriptor {
  const { projectRoot } = getProjectPaths(projectPath);
  return {
    schema: 1,
    transport: "pipe",
    pipeName: computePipeName(projectRoot),
    projectRoot,
  };
}

export function resolveEndpointDescriptor(projectPath?: string): EndpointDescriptor {
  if (process.platform === "win32") {
    return getDefaultPipeEndpoint(projectPath);
  }
  return getDefaultUnixEndpoint(projectPath);
}

export function endpointSeemsPresent(endpoint: EndpointDescriptor): boolean {
  if (endpoint.transport === "unix") {
    return existsSync(endpoint.path);
  }

  // pipe and tcp: liveness is deferred to tryHealth / fetchEndpoint
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

  if (endpoint.transport === "pipe") {
    return fetchViaPipe(endpoint.pipeName, pathname, init);
  }

  return fetch(`http://${endpoint.host}:${endpoint.port}${pathname}`, {
    ...init,
    headers: mergeHeaders(init?.headers, {
      "X-Unictl-Token": endpoint.token,
    }),
  });
}

/**
 * Named Pipe를 통한 line-based JSON 통신.
 * Request:  {"method":"GET|POST","path":"/...","body":{...}}\n
 * Response: {"status":200,"body":{...}}\n
 */
async function fetchViaPipe(
  pipeName: string,
  pathname: string,
  init?: RequestInit
): Promise<Response> {
  const method = init?.method ?? "GET";
  let body: unknown = undefined;
  if (init?.body) {
    try { body = JSON.parse(String(init.body)); }
    catch { body = String(init.body); }
  }

  const request = JSON.stringify({ method, path: pathname, body: body ?? {} });

  return new Promise<Response>((resolve, reject) => {
    const sock = connect(pipeName);
    let buf = "";

    const timeout = setTimeout(() => {
      sock.destroy();
      reject(new Error(`Pipe connection timeout: ${pipeName}`));
    }, 2_000);

    sock.on("connect", () => {
      sock.write(request + "\n");
    });

    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const idx = buf.indexOf("\n");
      if (idx === -1) return;

      clearTimeout(timeout);
      const line = buf.slice(0, idx);
      sock.end();

      try {
        const parsed = JSON.parse(line);
        const responseBody = JSON.stringify(parsed.body ?? parsed);
        resolve(new Response(responseBody, {
          status: parsed.status ?? 200,
          headers: { "Content-Type": "application/json" },
        }));
      } catch {
        reject(new Error(`Invalid JSON from pipe: ${line}`));
      }
    });

    sock.on("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
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

  if (endpoint.transport === "pipe") {
    return endpoint.pipeName;
  }

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
