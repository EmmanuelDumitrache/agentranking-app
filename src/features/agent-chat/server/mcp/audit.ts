import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { redactSensitiveData } from "@/lib/security/sensitive-data-redaction";

type McpAuditDb = Pick<Prisma.TransactionClient, "agentMcpAuditLog">;

const AUDIT_METADATA_KEYS = new Set([
  "acknowledgedSchemaHash",
  "added",
  "administrator",
  "approvalDecision",
  "approvalMode",
  "authMode",
  "authorizationPending",
  "catalogRevision",
  "changed",
  "changedFields",
  "connectedWithoutRedirect",
  "createdWithConnection",
  "credentialReplaced",
  "detachedBindings",
  "durationMs",
  "effectiveRisk",
  "enabled",
  "endpointOrigin",
  "error",
  "inputHash",
  "identityChanged",
  "manifestChanged",
  "metadataChanged",
  "maxCallsPerRun",
  "maxParallelCalls",
  "operation",
  "oauthRevocation",
  "previousRevision",
  "previousEffectiveRisk",
  "previousSchemaHash",
  "providerKey",
  "quarantined",
  "removed",
  "requestBytes",
  "resourceOrigin",
  "responseBytes",
  "retainedCatalogRevision",
  "retryCount",
  "riskClassificationChanged",
  "revision",
  "runId",
  "schemaHash",
  "unsignedTransactionProduced",
]);

function safeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const allowed = Object.fromEntries(
    Object.entries(metadata).filter(([key]) => AUDIT_METADATA_KEYS.has(key)),
  );
  return Object.keys(allowed).length
    ? redactSensitiveData(allowed)
    : undefined;
}

export async function writeMcpAudit(params: {
  appAccountId: string;
  actorProfileId?: number;
  agentDbId?: number;
  bindingId?: string;
  connectionId?: string;
  toolId?: string;
  action: string;
  status: "STARTED" | "SUCCEEDED" | "FAILED" | "BLOCKED";
  reasonCode?: string;
  metadata?: Record<string, unknown>;
}, db: McpAuditDb = prisma): Promise<void> {
  await db.agentMcpAuditLog.create({
    data: {
      appAccountId: params.appAccountId,
      actorProfileId: params.actorProfileId,
      agentDbId: params.agentDbId,
      bindingId: params.bindingId,
      connectionId: params.connectionId,
      toolId: params.toolId,
      action: params.action.slice(0, 80),
      status: params.status,
      reasonCode: params.reasonCode?.slice(0, 80),
      metadataJson: safeAuditMetadata(params.metadata) as never,
    },
  });
}
