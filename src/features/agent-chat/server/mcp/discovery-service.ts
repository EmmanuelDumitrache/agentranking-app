import "server-only";

import { writeMcpAudit } from "./audit";
import { discoverMcpCatalog, type McpDiscoveryResult } from "./catalog";
import { connectMcpClient } from "./client-factory";
import {
  isMcpCancellation,
  mcpConnectionStatusForError,
  mcpErrorCode,
  McpRuntimeError,
  safeMcpErrorDetails,
} from "./errors";
import {
  recordMcpCircuitFailure,
  withMcpConnectionSingleFlight,
} from "./reliability";
import { recordMcpCatalogChanges, withObservedMcpOperation } from "./observability";
import { assertMcpConnectionRuntimeAllowed } from "./platform-policy";
import {
  getMcpConnection,
  updateMcpConnectionStatus,
} from "./repository";

export async function verifyAndDiscoverMcpConnection(params: {
  appAccountId: string;
  connectionId: string;
  actorProfileId?: number;
  signal?: AbortSignal;
  operation?: "verify" | "discover";
  administrativeOverride?: boolean;
}): Promise<McpDiscoveryResult> {
  const operation = params.operation ?? "verify";
  return await withMcpConnectionSingleFlight(params.connectionId, operation, async (leaseSignal) => {
    const signal = params.signal
      ? AbortSignal.any([params.signal, leaseSignal])
      : leaseSignal;
    const connection = await getMcpConnection({
      appAccountId: params.appAccountId,
      connectionId: params.connectionId,
    });
    if (!connection) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP connection was not found");
    const globallyDisabled = Boolean(connection.disabledAt) || connection.status === "DISABLED";
    if (globallyDisabled && !params.administrativeOverride) {
      throw new McpRuntimeError("MCP_CONNECTION_NOT_READY", "Enable the account connection before verification");
    }
    if (connection.status === "BLOCKED" && !params.administrativeOverride) {
      throw new McpRuntimeError(
        "MCP_ENDPOINT_BLOCKED",
        "This connection is blocked and requires an administrator recovery action",
      );
    }
    if (!params.administrativeOverride) await assertMcpConnectionRuntimeAllowed(connection);
    return await withObservedMcpOperation({
      spanName: operation === "discover" ? "mcp.discover_tools" : "mcp.verify_connection",
      operation,
      providerKey: connection.providerKey,
      attributes: {
        "mcp.connection_id": connection.id,
        "mcp.catalog_revision": connection.catalogRevision,
        "mcp.transport": connection.transportMode,
      },
      task: async () => {
        const transitioned = await updateMcpConnectionStatus({
          connectionId: connection.id,
          status: "VERIFYING",
          expectedVersion: connection.version,
          expectedStatuses: [connection.status],
          allowControlledStateOverride: params.administrativeOverride,
        });
        if (!transitioned) {
          throw new McpRuntimeError(
            "MCP_STALE_VERSION",
            "Connection changed before MCP verification could start",
          );
        }
        await writeMcpAudit({
          appAccountId: params.appAccountId,
          actorProfileId: params.actorProfileId,
          connectionId: connection.id,
          action: operation === "discover" ? "CATALOG_DISCOVERY" : "CONNECTION_VERIFY",
          status: "STARTED",
          metadata: {
            providerKey: connection.providerKey,
            endpointOrigin: connection.endpointOrigin,
            previousRevision: connection.catalogRevision,
          },
        });
        let connected: Awaited<ReturnType<typeof connectMcpClient>> | null = null;
        try {
          connected = await connectMcpClient({ connection, signal });
          const result = await discoverMcpCatalog({
            connection,
            client: connected.client,
            signal,
            finalConnectionStatus: globallyDisabled ? "DISABLED" : "READY",
          });
          recordMcpCatalogChanges({
            providerKey: connection.providerKey,
            ...result.changes,
          });
          await writeMcpAudit({
            appAccountId: params.appAccountId,
            actorProfileId: params.actorProfileId,
            connectionId: connection.id,
            action: operation === "discover" ? "CATALOG_DISCOVERY" : "CONNECTION_VERIFY",
            status: "SUCCEEDED",
            metadata: {
              providerKey: connection.providerKey,
              endpointOrigin: connection.endpointOrigin,
              ...result.changes,
            },
          });
          return result;
        } catch (error) {
          if (!isMcpCancellation(error, signal)) {
            await recordMcpCircuitFailure(connection.id, error).catch(() => undefined);
            const failureStatus = mcpConnectionStatusForError(error);
            const status = ["REAUTH_REQUIRED", "BLOCKED", "INVALID"].includes(failureStatus)
              ? failureStatus
              : connection.catalogRevision > 0
                ? "DEGRADED"
                : failureStatus;
            await updateMcpConnectionStatus({
              connectionId: connection.id,
              status,
              reasonCode: mcpErrorCode(error),
              error,
              expectedVersion: connection.version,
              expectedStatuses: ["VERIFYING"],
              allowControlledStateOverride: params.administrativeOverride,
            }).catch(() => undefined);
            await writeMcpAudit({
              appAccountId: params.appAccountId,
              actorProfileId: params.actorProfileId,
              connectionId: connection.id,
              action: operation === "discover" ? "CATALOG_DISCOVERY" : "CONNECTION_VERIFY",
              status: "FAILED",
              reasonCode: mcpErrorCode(error),
              metadata: {
                providerKey: connection.providerKey,
                endpointOrigin: connection.endpointOrigin,
                retainedCatalogRevision: connection.catalogRevision,
                error: safeMcpErrorDetails(error),
              },
            }).catch(() => undefined);
          }
          throw error;
        } finally {
          await connected?.close().catch(() => undefined);
        }
      },
    });
  });
}
