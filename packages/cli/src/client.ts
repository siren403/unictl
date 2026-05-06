import {
  endpointSeemsPresent,
  fetchEndpoint,
  resolveEndpointDescriptor,
  type EndpointDescriptor,
} from "./socket";

function describeEndpoint(endpoint: EndpointDescriptor): string {
  if (endpoint.transport === "unix") {
    return endpoint.path;
  }

  if (endpoint.transport === "pipe") {
    return endpoint.pipeName;
  }

  return `${endpoint.host}:${endpoint.port}`;
}

function createEndpointUnavailableError(projectPath: string | undefined, endpoint: EndpointDescriptor): Error {
  if (!endpointSeemsPresent(endpoint)) {
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

/**
 * Phase D: GET /liveness — used by `unictl wait` to poll editor phase.
 *
 * Returns the parsed JSON body on success, including the standard
 *   { schema_version, alive_ms_ago, last_heartbeat_ms, last_state, pid,
 *     handler_registered, phase_override, native_version }
 * shape from format_liveness_response (lib.rs:74). On 503 reload windows
 * the native side returns `{editor_reload_active: true, ...}` and the wait
 * loop interprets that as `phase=reloading`.
 *
 * Throws when the endpoint is missing or the connection cannot be made;
 * callers in the wait loop should catch and treat as `not_reachable`.
 */
export async function liveness(opts?: { project?: string }): Promise<unknown> {
  return requestJson("/liveness", undefined, opts);
}
