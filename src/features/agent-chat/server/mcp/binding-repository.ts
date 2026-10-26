import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { validateMcpJsonSchema } from "./catalog-validation";
import { McpRuntimeError } from "./errors";
import { getMcpProviderManifest, providerAllowsExistingConnection } from "./provider-registry";
import { GENERIC_MCP_HARD_BLOCK_RISKS } from "./risk";
import {
  evaluateMcpConnectionPlatformPolicy,
  evaluateMcpToolPlatformPolicy,
  listActiveMcpAdminRules,
} from "./platform-policy";
import type {
  McpApprovalMode,
  McpBindingRecord,
  McpConnectionRecord,
  McpToolDescriptorRecord,
  McpToolPolicyRecord,
  McpToolRisk,
} from "./types";

const DEFAULT_LIMITS = Object.freeze({
  maxCallsPerRun: 12,
  maxParallelCalls: 2,
  callTimeoutMs: 30_000,
  outputByteLimit: 1024 * 1024,
});
const PLATFORM_MAX = Object.freeze({
  maxCallsPerRun: 50,
  maxParallelCalls: 4,
  callTimeoutMs: 60_000,
  outputByteLimit: 1024 * 1024,
});
const RISK_DESCENDING: readonly McpToolRisk[] = [
  "UNKNOWN",
  "CUSTODY",
  "PAYMENT",
  "BROADCAST",
  "SIGN",
  "TRADE",
  "INFRA_ADMIN",
  "WRITE_OFFCHAIN",
  "TRANSACTION_PREPARE",
  "ANALYTICS_QUERY",
  "READ_ONLY",
];

function clamp(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value!)));
}

export function connectionCanBeEnabled(
  connection: Pick<McpConnectionRecord, "status" | "disabledAt" | "deletedAt" | "catalogRevision" | "providerKey" | "manifestVersion">,
): { ok: true } | { ok: false; code: string; reason: string } {
  if (connection.deletedAt || connection.status === "DELETED") {
    return { ok: false, code: "MCP_CONNECTION_NOT_FOUND", reason: "Connection was deleted." };
  }
  if (connection.disabledAt || connection.status === "DISABLED") {
    return { ok: false, code: "MCP_CONNECTION_NOT_READY", reason: "Connection is globally disabled." };
  }
  if (connection.status === "REAUTH_REQUIRED" || connection.status === "AUTH_PENDING") {
    return { ok: false, code: "MCP_CONNECTION_REAUTH_REQUIRED", reason: "Reconnect this connection first." };
  }
  if (!["READY", "DEGRADED"].includes(connection.status) || connection.catalogRevision < 1) {
    return { ok: false, code: "MCP_CONNECTION_NOT_READY", reason: "Verify and discover this connection first." };
  }
  const manifest = getMcpProviderManifest(connection.providerKey);
  if (!providerAllowsExistingConnection(manifest, connection.providerKey)) {
    return { ok: false, code: "MCP_POLICY_BLOCKED", reason: "This provider is not admitted for remote execution." };
  }
  if (manifest && connection.manifestVersion !== manifest.manifestVersion) {
    return {
      ok: false,
      code: "MCP_CATALOG_STALE",
      reason: "The reviewed provider policy changed. Refresh and review the tool catalog before enabling it.",
    };
  }
  return { ok: true };
}

export async function listAgentMcpBindings(params: {
  appAccountId: string;
  agentDbId: number;
}) {
  const [agent, connections, rules] = await Promise.all([
    prisma.agent.findFirst({
      where: { id: params.agentDbId, ownerAccountId: params.appAccountId },
      select: { id: true },
    }),
    prisma.agentMcpConnection.findMany({
      where: { appAccountId: params.appAccountId, deletedAt: null },
      include: {
        credential: true,
        catalog: true,
        tools: { orderBy: { name: "asc" } },
        bindings: {
          where: { agentDbId: params.agentDbId },
          include: { toolPolicies: true },
        },
        _count: { select: { bindings: { where: { enabled: true } } } },
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
    }),
    listActiveMcpAdminRules(),
  ]);
  if (!agent) throw new McpRuntimeError("MCP_CONNECTION_OWNERSHIP_MISMATCH", "Agent is not owned by this account");
  return connections.map((connection) => {
    const binding = connection.bindings[0] ?? null;
    const record = connection as unknown as McpConnectionRecord;
    const localEligibility = connectionCanBeEnabled(record);
    const platformEligibility = evaluateMcpConnectionPlatformPolicy({
      phase: "runtime",
      appAccountId: record.appAccountId,
      providerKey: record.providerKey,
      endpointOrigin: record.endpointOrigin,
      connectionId: record.id,
      rules,
    });
    const eligibility = !localEligibility.ok
      ? localEligibility
      : platformEligibility.allowed
        ? { ok: true as const }
        : {
            ok: false as const,
            code: platformEligibility.code ?? "MCP_POLICY_BLOCKED",
            reason: platformEligibility.reason ?? "Connection is disabled by platform policy.",
          };
    const policies = new Map(
      (binding?.toolPolicies ?? []).map((policy) => [policy.toolId, policy]),
    );
    const enabledTools = binding?.enabled && eligibility.ok
      ? connection.tools.filter((tool) => {
          const policy = policies.get(tool.id);
          if (!tool.active || GENERIC_MCP_HARD_BLOCK_RISKS.has(tool.effectiveRisk)) return false;
          if (policy?.enabled === false) return false;
          if (tool.quarantined && policy?.acknowledgedSchemaHash !== tool.schemaHash) return false;
          if (policy?.acknowledgedSchemaHash && policy.acknowledgedSchemaHash !== tool.schemaHash) return false;
          return evaluateMcpToolPlatformPolicy({
            connection: record,
            toolName: tool.name,
            risk: tool.effectiveRisk,
            rules,
          }).allowed;
        })
      : [];
    return {
      connection: connection as unknown as McpConnectionRecord & {
        _count: { bindings: number };
      },
      binding: binding as unknown as McpBindingRecord | null,
      canEnable: eligibility.ok,
      enableBlockedReason: eligibility.ok ? undefined : eligibility.reason,
      enableBlockedCode: eligibility.ok ? undefined : eligibility.code,
      attachedAgentCount: connection._count.bindings,
      enabledToolCount: enabledTools.length,
      highestEnabledRisk: RISK_DESCENDING.find((risk) =>
        enabledTools.some((tool) => tool.effectiveRisk === risk)) ?? null,
    };
  });
}

export async function upsertAgentMcpBinding(params: {
  appAccountId: string;
  agentDbId: number;
  connectionId: string;
  enabled: boolean;
  approvalMode?: McpApprovalMode;
  maxCallsPerRun?: number;
  maxParallelCalls?: number;
  callTimeoutMs?: number;
  outputByteLimit?: number;
  expectedVersion?: number;
}): Promise<McpBindingRecord> {
  const rules = params.enabled ? await listActiveMcpAdminRules() : [];
  return await prisma.$transaction(async (tx) => {
    // Serialize assignment creation with connection deletion. Without a row
    // lock, an assignment could be inserted after the delete route's in-use
    // check but before the connection is marked deleted.
    const lockedConnection = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "agent_mcp_connections"
      WHERE "id" = ${params.connectionId}
        AND "app_account_id" = ${params.appAccountId}
        AND "deleted_at" IS NULL
      FOR UPDATE
    `);
    if (lockedConnection.length !== 1) {
      throw new McpRuntimeError(
        "MCP_CONNECTION_OWNERSHIP_MISMATCH",
        "Agent and connection must belong to the same account",
      );
    }
    const [agent, connection, existing] = await Promise.all([
      tx.agent.findFirst({
        where: { id: params.agentDbId, ownerAccountId: params.appAccountId },
        select: { id: true },
      }),
      tx.agentMcpConnection.findFirst({
        where: {
          id: params.connectionId,
          appAccountId: params.appAccountId,
          deletedAt: null,
        },
      }),
      tx.agentMcpBinding.findUnique({
        where: {
          agentDbId_connectionId: {
            agentDbId: params.agentDbId,
            connectionId: params.connectionId,
          },
        },
        include: { toolPolicies: true },
      }),
    ]);
    if (!agent || !connection) {
      throw new McpRuntimeError("MCP_CONNECTION_OWNERSHIP_MISMATCH", "Agent and connection must belong to the same account");
    }
    if (params.enabled) {
      const record = connection as unknown as McpConnectionRecord;
      const eligibility = connectionCanBeEnabled(record);
      if (!eligibility.ok) throw new McpRuntimeError(eligibility.code, eligibility.reason);
      const platform = evaluateMcpConnectionPlatformPolicy({
        phase: "runtime",
        appAccountId: record.appAccountId,
        providerKey: record.providerKey,
        endpointOrigin: record.endpointOrigin,
        connectionId: record.id,
        rules,
      });
      if (!platform.allowed) {
        throw new McpRuntimeError(
          platform.code ?? "MCP_POLICY_BLOCKED",
          platform.reason ?? "Connection is disabled by platform policy",
        );
      }
    }
    const manifest = getMcpProviderManifest(connection.providerKey);
    const defaults = manifest?.defaultBindingPolicy;
    const approvalMode = params.approvalMode
      ?? existing?.approvalMode
      ?? defaults?.approvalMode
      ?? "CONFIRM_EVERY_CALL";
    const data = {
      appAccountId: params.appAccountId,
      enabled: params.enabled,
      approvalMode,
      maxCallsPerRun: clamp(
        params.maxCallsPerRun,
        existing?.maxCallsPerRun ?? defaults?.maxCallsPerRun ?? DEFAULT_LIMITS.maxCallsPerRun,
        1,
        PLATFORM_MAX.maxCallsPerRun,
      ),
      maxParallelCalls: clamp(
        params.maxParallelCalls,
        existing?.maxParallelCalls ?? defaults?.maxParallelCalls ?? DEFAULT_LIMITS.maxParallelCalls,
        1,
        PLATFORM_MAX.maxParallelCalls,
      ),
      callTimeoutMs: clamp(
        params.callTimeoutMs,
        existing?.callTimeoutMs ?? DEFAULT_LIMITS.callTimeoutMs,
        1_000,
        PLATFORM_MAX.callTimeoutMs,
      ),
      outputByteLimit: clamp(
        params.outputByteLimit,
        existing?.outputByteLimit ?? DEFAULT_LIMITS.outputByteLimit,
        16 * 1024,
        PLATFORM_MAX.outputByteLimit,
      ),
    };
    const unchanged = Boolean(existing
      && existing.appAccountId === data.appAccountId
      && existing.enabled === data.enabled
      && existing.approvalMode === data.approvalMode
      && existing.maxCallsPerRun === data.maxCallsPerRun
      && existing.maxParallelCalls === data.maxParallelCalls
      && existing.callTimeoutMs === data.callTimeoutMs
      && existing.outputByteLimit === data.outputByteLimit);
    if (existing && params.expectedVersion !== existing.version) {
      if (unchanged) {
        if (!params.enabled) {
          await tx.agentMcpContinuation.deleteMany({ where: { bindingId: existing.id } });
        }
        return existing as unknown as McpBindingRecord;
      }
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        params.expectedVersion === undefined
          ? "An expected assignment version is required"
          : "Connection assignment was changed in another session",
      );
    }
    if (!existing && params.expectedVersion !== undefined) {
      throw new McpRuntimeError(
        "MCP_STALE_VERSION",
        "Connection assignment was removed in another session",
      );
    }
    if (existing && unchanged) {
      if (!params.enabled) {
        await tx.agentMcpContinuation.deleteMany({ where: { bindingId: existing.id } });
      }
      return existing as unknown as McpBindingRecord;
    }
    const binding = existing
      ? await tx.agentMcpBinding.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
          include: { toolPolicies: true },
        })
      : await tx.agentMcpBinding.create({
          data: {
            ...data,
            agentDbId: params.agentDbId,
            connectionId: params.connectionId,
          },
          include: { toolPolicies: true },
        });
    if (!params.enabled) {
      await tx.agentMcpContinuation.deleteMany({ where: { bindingId: binding.id } });
    }
    return binding as unknown as McpBindingRecord;
  });
}

export async function removeAgentMcpBinding(params: {
  appAccountId: string;
  agentDbId: number;
  connectionId: string;
}): Promise<boolean> {
  const removed = await prisma.agentMcpBinding.deleteMany({
    where: {
      appAccountId: params.appAccountId,
      agentDbId: params.agentDbId,
      connectionId: params.connectionId,
    },
  });
  return removed.count > 0;
}

export async function listBindingMcpTools(params: {
  appAccountId: string;
  agentDbId: number;
  connectionId: string;
}): Promise<{
  binding: McpBindingRecord;
  tools: Array<{
    descriptor: McpToolDescriptorRecord;
    policy: McpToolPolicyRecord | null;
    platformBlocked: boolean;
    platformReason: string | null;
  }>;
}> {
  const [binding, rules] = await Promise.all([
    prisma.agentMcpBinding.findFirst({
      where: {
        appAccountId: params.appAccountId,
        agentDbId: params.agentDbId,
        connectionId: params.connectionId,
      },
      include: {
        toolPolicies: true,
        connection: {
          include: { tools: { orderBy: [{ effectiveRisk: "asc" }, { name: "asc" }] } },
        },
      },
    }),
    listActiveMcpAdminRules(),
  ]);
  if (!binding) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "Agent connection assignment was not found");
  const policies = new Map(binding.toolPolicies.map((policy) => [policy.toolId, policy]));
  return {
    binding: binding as unknown as McpBindingRecord,
    tools: binding.connection.tools.map((descriptor) => {
      const record = descriptor as unknown as McpToolDescriptorRecord;
      const platform = evaluateMcpToolPlatformPolicy({
        connection: binding.connection as unknown as McpConnectionRecord,
        toolName: record.name,
        risk: record.effectiveRisk,
        rules,
      });
      return {
        descriptor: platform.quarantined
          ? {
              ...record,
              quarantined: true,
              quarantineReason: platform.reason ?? record.quarantineReason,
            }
          : record,
        policy: (policies.get(descriptor.id) ?? null) as unknown as McpToolPolicyRecord | null,
        platformBlocked: !platform.allowed,
        platformReason: platform.reason ?? null,
      };
    }),
  };
}

export type McpToolPolicyPatch = {
  enabled?: boolean;
  approvalMode?: McpApprovalMode | null;
  maxCallsPerRun?: number | null;
  inputConstraint?: Record<string, unknown> | null;
  acknowledgeSchemaHash?: string | null;
  reset?: boolean;
};

export async function patchBindingMcpToolPolicy(params: {
  appAccountId: string;
  agentDbId: number;
  connectionId: string;
  toolId: string;
  patch: McpToolPolicyPatch;
}): Promise<McpToolPolicyRecord | null> {
  const rules = params.patch.enabled === true ? await listActiveMcpAdminRules() : [];
  return await prisma.$transaction(async (tx) => {
    const binding = await tx.agentMcpBinding.findFirst({
      where: {
        appAccountId: params.appAccountId,
        agentDbId: params.agentDbId,
        connectionId: params.connectionId,
      },
      include: { connection: true },
    });
    const tool = await tx.agentMcpToolDescriptor.findFirst({
      where: { id: params.toolId, connectionId: params.connectionId },
    });
    if (!binding || !tool) throw new McpRuntimeError("MCP_CONNECTION_NOT_FOUND", "Tool assignment was not found");
    if (params.patch.reset) {
      await tx.agentMcpToolPolicy.deleteMany({
        where: { bindingId: binding.id, toolId: tool.id },
      });
      return null;
    }
    if (params.patch.enabled === true && GENERIC_MCP_HARD_BLOCK_RISKS.has(tool.effectiveRisk)) {
      throw new McpRuntimeError(
        "MCP_POLICY_BLOCKED",
        "This risk class cannot be enabled through the generic MCP policy path",
      );
    }
    if (params.patch.enabled === true) {
      const platform = evaluateMcpToolPlatformPolicy({
        connection: binding.connection as unknown as McpConnectionRecord,
        toolName: tool.name,
        risk: tool.effectiveRisk,
        rules,
      });
      if (!platform.allowed) {
        throw new McpRuntimeError(
          platform.code ?? "MCP_POLICY_BLOCKED",
          platform.reason ?? "Tool is disabled by platform policy",
        );
      }
    }
    const acknowledged = params.patch.acknowledgeSchemaHash === undefined
      ? undefined
      : params.patch.acknowledgeSchemaHash === null
        ? null
        : params.patch.acknowledgeSchemaHash === tool.schemaHash
          ? tool.schemaHash
          : (() => { throw new McpRuntimeError("MCP_CATALOG_CHANGED", "Tool schema changed before acknowledgement"); })();
    const existingPolicy = await tx.agentMcpToolPolicy.findUnique({
      where: { bindingId_toolId: { bindingId: binding.id, toolId: tool.id } },
      select: { acknowledgedSchemaHash: true },
    });
    if (
      params.patch.enabled === true
      && tool.quarantined
      && (acknowledged ?? existingPolicy?.acknowledgedSchemaHash) !== tool.schemaHash
    ) {
      throw new McpRuntimeError(
        "MCP_TOOL_QUARANTINED",
        "Review and acknowledge the current tool schema before enabling it",
      );
    }
    const inputConstraint = params.patch.inputConstraint
      ? validateMcpJsonSchema(params.patch.inputConstraint, "Tool input constraint")
      : params.patch.inputConstraint;
    if (inputConstraint && Buffer.byteLength(JSON.stringify(inputConstraint), "utf8") > 32 * 1024) {
      throw new McpRuntimeError("MCP_POLICY_BLOCKED", "Tool input constraint is too large");
    }
    const data = {
      enabled: params.patch.enabled,
      approvalMode: params.patch.approvalMode,
      maxCallsPerRun: params.patch.maxCallsPerRun === null
        ? null
        : params.patch.maxCallsPerRun === undefined
          ? undefined
          : clamp(params.patch.maxCallsPerRun, 1, 1, PLATFORM_MAX.maxCallsPerRun),
      inputConstraint: inputConstraint === null
        ? Prisma.JsonNull
        : inputConstraint === undefined
          ? undefined
          : inputConstraint as Prisma.InputJsonValue,
      acknowledgedSchemaHash: acknowledged,
    };
    const policy = await tx.agentMcpToolPolicy.upsert({
      where: {
        bindingId_toolId: { bindingId: binding.id, toolId: tool.id },
      },
      create: {
        bindingId: binding.id,
        connectionId: params.connectionId,
        toolId: tool.id,
        enabled: data.enabled ?? true,
        approvalMode: data.approvalMode,
        maxCallsPerRun: data.maxCallsPerRun,
        inputConstraint: data.inputConstraint,
        acknowledgedSchemaHash: data.acknowledgedSchemaHash,
      },
      update: data,
    });
    return policy as unknown as McpToolPolicyRecord;
  });
}

export type RuntimeMcpBinding = {
  binding: McpBindingRecord;
  connection: McpConnectionRecord;
  tools: Array<{
    descriptor: McpToolDescriptorRecord;
    policy: McpToolPolicyRecord | null;
  }>;
};

export type RuntimeMcpBindingWarning = {
  connectionId: string;
  code: string;
  message: string;
};

export async function listRuntimeMcpBindingWarnings(params: {
  appAccountId: string;
  agentDbId: number;
}): Promise<RuntimeMcpBindingWarning[]> {
  const [rows, rules] = await Promise.all([
    prisma.agentMcpBinding.findMany({
      where: {
        appAccountId: params.appAccountId,
        agentDbId: params.agentDbId,
        enabled: true,
        connection: { appAccountId: params.appAccountId, deletedAt: null },
      },
      select: {
        connection: {
          select: {
            id: true,
            appAccountId: true,
            providerKey: true,
            displayName: true,
            endpointOrigin: true,
            status: true,
            disabledAt: true,
            catalogRevision: true,
            manifestVersion: true,
            deletedAt: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    listActiveMcpAdminRules(),
  ]);
  return rows.flatMap(({ connection }) => {
    const record = connection as unknown as McpConnectionRecord;
    const local = connectionCanBeEnabled(record);
    const platform = evaluateMcpConnectionPlatformPolicy({
      phase: "runtime",
      appAccountId: record.appAccountId,
      providerKey: record.providerKey,
      endpointOrigin: record.endpointOrigin,
      connectionId: record.id,
      rules,
    });
    if (local.ok && platform.allowed) return [];
    const code = local.ok
      ? platform.code ?? "MCP_POLICY_BLOCKED"
      : local.code;
    const recovery = code === "MCP_CONNECTION_REAUTH_REQUIRED"
      ? "Reconnect it in Dashboard → Connections."
      : code === "MCP_CATALOG_STALE"
        ? "Refresh its catalog in Dashboard → Connections."
      : code === "MCP_CONNECTION_NOT_READY"
        ? record.disabledAt || record.status === "DISABLED"
          ? "Enable it in Dashboard → Connections."
          : "Verify it in Dashboard → Connections."
        : "Review it in Dashboard → Connections.";
    return [{
      connectionId: record.id,
      code,
      message: `${record.displayName} is unavailable for this chat. ${recovery} Other connections and chat remain available.`,
    }];
  });
}

export async function listRuntimeMcpBindings(params: {
  appAccountId: string;
  agentDbId: number;
}): Promise<RuntimeMcpBinding[]> {
  const [rows, rules] = await Promise.all([
    prisma.agentMcpBinding.findMany({
      where: {
        appAccountId: params.appAccountId,
        agentDbId: params.agentDbId,
        enabled: true,
        connection: {
          appAccountId: params.appAccountId,
          deletedAt: null,
          disabledAt: null,
          status: { in: ["READY", "DEGRADED"] },
        },
      },
      include: {
        toolPolicies: true,
        connection: {
          include: {
            credential: true,
            catalog: true,
            tools: {
              where: { active: true },
              orderBy: { name: "asc" },
            },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    listActiveMcpAdminRules(),
  ]);
  return rows.flatMap((row) => {
    const policies = new Map(row.toolPolicies.map((policy) => [policy.toolId, policy]));
    const connection = row.connection as unknown as McpConnectionRecord;
    const localEligibility = connectionCanBeEnabled(connection);
    if (!localEligibility.ok || row.approvalMode === "BLOCK_ALL") return [];
    const connectionPolicy = evaluateMcpConnectionPlatformPolicy({
      phase: "runtime",
      appAccountId: connection.appAccountId,
      providerKey: connection.providerKey,
      endpointOrigin: connection.endpointOrigin,
      connectionId: connection.id,
      rules,
    });
    if (!connectionPolicy.allowed) return [];
    return [{
      binding: row as unknown as McpBindingRecord,
      connection,
      tools: row.connection.tools
        .map((descriptor) => ({
          descriptor: descriptor as unknown as McpToolDescriptorRecord,
          policy: (policies.get(descriptor.id) ?? null) as unknown as McpToolPolicyRecord | null,
        }))
        .filter(({ descriptor, policy }) =>
          !GENERIC_MCP_HARD_BLOCK_RISKS.has(descriptor.effectiveRisk)
          && (!descriptor.quarantined || policy?.acknowledgedSchemaHash === descriptor.schemaHash),
        )
        .filter(({ descriptor }) => evaluateMcpToolPlatformPolicy({
          connection,
          toolName: descriptor.name,
          risk: descriptor.effectiveRisk,
          rules,
        }).allowed),
    }];
  });
}
