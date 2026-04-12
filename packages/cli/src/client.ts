import {
  endpointSeemsPresent,
  fetchEndpoint,
  getProjectPaths,
  hasEndpointFile,
  resolveEndpointDescriptor,
  type EndpointDescriptor,
} from "./socket";

function describeEndpoint(endpoint: EndpointDescriptor): string {
  if (endpoint.transport === "unix") {
    return endpoint.path;
  }

  return `${endpoint.host}:${endpoint.port}`;
}

function createEndpointUnavailableError(projectPath: string | undefined, endpoint: EndpointDescriptor): Error {
  const { endpointPath } = getProjectPaths(projectPath);
  const endpointFileExists = hasEndpointFile(projectPath);

  if (!endpointSeemsPresent(endpoint)) {
    if (endpointFileExists) {
      return new Error(
        `Unictl endpoint is stale or unreachable (${describeEndpoint(endpoint)}). ` +
        `Check ${endpointPath} or run \`unictl doctor --project ${endpoint.projectRoot}\`.`
      );
    }

    return new Error(
      `Unity editor endpoint not found for project ${endpoint.projectRoot}. ` +
      `Run \`unictl editor open --project ${endpoint.projectRoot}\` or ` +
      `\`unictl doctor --project ${endpoint.projectRoot}\`.`
    );
  }

  return new Error(
    `Failed to reach unictl endpoint at ${describeEndpoint(endpoint)}. ` +
    `Run \`unictl doctor --project ${endpoint.projectRoot}\` for diagnostics.`
  );
}

async function requestJson(
  pathname: string,
  init: RequestInit | undefined,
  opts?: { project?: string }
): Promise<unknown> {
  const endpoint = resolveEndpointDescriptor(opts?.project);

  if (!endpointSeemsPresent(endpoint)) {
    throw createEndpointUnavailableError(opts?.project, endpoint);
  }

  try {
    const res = await fetchEndpoint(endpoint, pathname, init);
    return await res.json();
  } catch {
    throw createEndpointUnavailableError(opts?.project, endpoint);
  }
}

export async function command(
  cmd: string,
  params?: Record<string, unknown>,
  opts?: { project?: string }
): Promise<unknown> {
  return requestJson(
    "/command",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: crypto.randomUUID(),
        command: cmd,
        params: params ?? {},
      }),
    },
    opts
  );
}

export async function health(opts?: { project?: string }): Promise<unknown> {
  return requestJson("/health", undefined, opts);
}
