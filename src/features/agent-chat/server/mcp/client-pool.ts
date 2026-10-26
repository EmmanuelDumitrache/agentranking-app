import "server-only";

import { connectMcpClient, type ConnectedMcpClient } from "./client-factory";
import {
  mcpConnectionStatusForError,
  McpRuntimeError,
  McpUnavailableError,
  safeMcpErrorDetails,
} from "./errors";
import { updateMcpConnectionStatus } from "./repository";
import type { McpCatalogSnapshot, McpConnectionRecord } from "./types";

function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new Error("MCP client request aborted"));
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(signal.reason ?? new Error("MCP client request aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export type McpRuntimeEntry = {
  connection: McpConnectionRecord;
  catalog: McpCatalogSnapshot;
  clientPromise?: Promise<ConnectedMcpClient>;
};

export class McpClientPool {
  private readonly entries = new Map<string, McpRuntimeEntry>();
  private readonly lifecycle = new AbortController();
  private closed = false;

  constructor(entries: readonly McpRuntimeEntry[]) {
    for (const entry of entries) this.entries.set(entry.connection.id, entry);
  }

  setConnected(connectionId: string, connected: ConnectedMcpClient): void {
    const entry = this.entries.get(connectionId);
    if (!entry) {
      throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP runtime connection is unavailable");
    }
    entry.clientPromise = Promise.resolve(connected);
  }

  getEntry(connectionId: string): McpRuntimeEntry | undefined {
    return this.entries.get(connectionId);
  }

  async getClient(
    connectionId: string,
    signal?: AbortSignal,
    liveConnection?: McpConnectionRecord,
  ): Promise<ConnectedMcpClient> {
    if (this.closed) throw new McpUnavailableError("MCP client pool is closed");
    const entry = this.entries.get(connectionId);
    if (!entry) {
      throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "MCP runtime connection is unavailable");
    }
    if (liveConnection) {
      const principalChanged =
        entry.connection.endpointFingerprint !== liveConnection.endpointFingerprint
        || entry.connection.authMode !== liveConnection.authMode
        || entry.connection.transportMode !== liveConnection.transportMode
        || entry.connection.manifestVersion !== liveConnection.manifestVersion
        || entry.connection.credential?.fingerprint !== liveConnection.credential?.fingerprint;
      if (principalChanged && entry.clientPromise) {
        const previous = entry.clientPromise;
        entry.clientPromise = undefined;
        void previous.then((client) => client.close()).catch(() => undefined);
      }
      entry.connection = liveConnection;
    }
    if (entry.clientPromise) return await awaitWithSignal(entry.clientPromise, signal);

    const connection = entry.connection;
    const pending = connectMcpClient({
      connection,
      // A connection is pooled state, not state owned by whichever tool call
      // happened to request it first. Individual callers may stop waiting
      // without cancelling establishment for concurrent/future callers.
      signal: this.lifecycle.signal,
    }).then(async (connected) => {
      await updateMcpConnectionStatus({
        connectionId: connection.id,
        status: "READY",
        expectedVersion: connection.version,
        expectedStatuses: [connection.status],
      }).catch((statusError) => {
        console.warn("[agent-chat] failed to persist MCP lazy-connect success", {
          connectionId: connection.id,
          error: safeMcpErrorDetails(statusError),
        });
      });
      return connected;
    }).catch(async (error) => {
      entry.clientPromise = undefined;
      if (!this.closed && !this.lifecycle.signal.aborted) {
        const status = mcpConnectionStatusForError(error);
        await updateMcpConnectionStatus({
          connectionId: connection.id,
          status,
          error,
          expectedVersion: connection.version,
          expectedStatuses: [connection.status],
        }).catch((statusError) => {
          console.warn("[agent-chat] failed to persist MCP lazy-connect failure", {
            connectionId: connection.id,
            error: safeMcpErrorDetails(statusError),
          });
        });
      }
      throw error;
    });
    entry.clientPromise = pending;
    return await awaitWithSignal(pending, signal);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.lifecycle.abort("mcp-client-pool-closed");
    const promises = Array.from(this.entries.values())
      .map((entry) => entry.clientPromise)
      .filter((value): value is Promise<ConnectedMcpClient> => value !== undefined);
    const settled = await Promise.allSettled(promises);
    await Promise.allSettled(
      settled.flatMap((result) =>
        result.status === "fulfilled" ? [result.value.close()] : [],
      ),
    );
  }
}
