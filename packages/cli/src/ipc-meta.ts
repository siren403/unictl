import type { EndpointDescriptor } from "./socket";
import { getCliPackageMeta } from "./meta";

export type IpcRequestMeta = {
  cli_version: string;
  client_pid: number;
  cli_args: string[];
  cwd: string;
  project_root: string;
  request_id: string;
  sent_at: string;
  transport: EndpointDescriptor["transport"];
  transport_id: string;
};

export function describeTransport(endpoint: EndpointDescriptor): string {
  if (endpoint.transport === "pipe") return endpoint.pipeName;
  if (endpoint.transport === "unix") return endpoint.path;
  return `${endpoint.host}:${endpoint.port}`;
}

export function createIpcRequestMeta(
  endpoint: EndpointDescriptor,
  requestId: string,
): IpcRequestMeta {
  return {
    cli_version: getCliPackageMeta().version,
    client_pid: process.pid,
    cli_args: process.argv.slice(),
    cwd: process.cwd(),
    project_root: endpoint.projectRoot,
    request_id: requestId,
    sent_at: new Date().toISOString(),
    transport: endpoint.transport,
    transport_id: describeTransport(endpoint),
  };
}
