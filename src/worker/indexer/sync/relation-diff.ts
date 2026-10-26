import { Prisma } from "@/generated/prisma/client";
import { prismaJson } from "../lib/prisma-json";
const RELATION_UPDATE_BATCH_SIZE = 1_000;
export type ChainServiceRow = {
  name: string;
  endpoint: string;
  version: string;
  sourceName: string | null;
  normalizedType: string | null;
  sourceEndpoint: string | null;
  endpointKind: string | null;
  endpointValid: boolean | null;
  sourceVersion: string | null;
  sourceDigest: string | null;
  sourceKind: string;
  skills?: unknown;
  domains?: unknown;
  capabilities?: unknown;
  extensions?: unknown;
};
function serviceKey(value: Pick<ChainServiceRow, "name" | "endpoint" | "version">): string {
  return `${value.name}\0${value.endpoint}\0${value.version}`;
}
function jsonScalar(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString(10)) ?? value.toString(10);
  return JSON.stringify(value) ?? String(value);
}
export function jsonEquivalent(left: unknown, right: unknown): boolean {
  if (left === right || Object.is(left, right)) return true;
  const leftArray = Array.isArray(left);
  const rightArray = Array.isArray(right);
  if (leftArray || rightArray) {
    if (!leftArray || !rightArray) return false;
    const leftItems = left as unknown[];
    const rightItems = right as unknown[];
    if (leftItems.length !== rightItems.length) return false;
    for (let index = 0; index < leftItems.length; index++) {
      if (!jsonEquivalent(leftItems[index], rightItems[index])) return false;
    }
    return true;
  }
  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  if (leftObject || rightObject) {
    if (!leftObject || !rightObject) return false;
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.prototype.hasOwnProperty.call(rightRecord, key)) return false;
      if (!jsonEquivalent(leftRecord[key], rightRecord[key])) return false;
    }
    return true;
  }
  return jsonScalar(left) === jsonScalar(right);
}
export type AgentServiceUpdate = {
  id: number;
  data: Omit<ChainServiceRow, "sourceKind"> & { sourceKind: string | null };
};
export type AgentMetadataUpdate = {
  id: number;
  value: string;
  sourceKind: string | null;
  sourceDigest: string | null;
  chainControlled: boolean;
};
function jsonSql(value: unknown): Prisma.Sql {
  if (value == null) return Prisma.sql`NULL::jsonb`;
  const serialized = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString(10);
    if (item instanceof Uint8Array) return `0x${Buffer.from(item).toString("hex")}`;
    return item;
  });
  return serialized == null ? Prisma.sql`NULL::jsonb` : Prisma.sql`${serialized}::jsonb`;
}
function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
/** Native text[] SQL literal for the skills/domains/capabilities columns. */
function textArraySql(value: unknown): Prisma.Sql {
  const items = stringArray(value);
  if (items.length === 0) return Prisma.sql`ARRAY[]::text[]`;
  return Prisma.sql`ARRAY[${Prisma.join(items.map((item) => Prisma.sql`${item}`))}]::text[]`;
}
export async function updateAgentServicesInBulk(
  tx: Prisma.TransactionClient,
  updates: AgentServiceUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  for (let offset = 0; offset < updates.length; offset += RELATION_UPDATE_BATCH_SIZE) {
    const batch = updates.slice(offset, offset + RELATION_UPDATE_BATCH_SIZE);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "AgentService" AS target SET
      "name" = incoming."name",
      "endpoint" = incoming."endpoint",
      "version" = incoming."version",
      "source_name" = incoming."source_name",
      "normalized_type" = incoming."normalized_type",
      "source_endpoint" = incoming."source_endpoint",
      "endpoint_kind" = incoming."endpoint_kind",
      "endpoint_valid" = incoming."endpoint_valid",
      "source_version" = incoming."source_version",
      "source_digest" = incoming."source_digest",
      "source_kind" = incoming."source_kind",
      "skills" = incoming."skills",
      "domains" = incoming."domains",
      "capabilities" = incoming."capabilities",
      "extensions" = incoming."extensions"
      FROM (VALUES ${Prisma.join(batch.map(({ id, data }) => Prisma.sql`(
      ${id}::integer,
      ${data.name}::text,
      ${data.endpoint}::text,
      ${data.version}::text,
      ${data.sourceName}::text,
      ${data.normalizedType}::text,
      ${data.sourceEndpoint}::text,
      ${data.endpointKind}::text,
      ${data.endpointValid}::boolean,
      ${data.sourceVersion}::text,
      ${data.sourceDigest}::text,
      ${data.sourceKind}::text,
      ${textArraySql(data.skills)},
      ${textArraySql(data.domains)},
      ${textArraySql(data.capabilities)},
      ${jsonSql(data.extensions)}
    )`))}) AS incoming(
      "id", "name", "endpoint", "version", "source_name", "normalized_type",
      "source_endpoint", "endpoint_kind", "endpoint_valid", "source_version",
      "source_digest", "source_kind", "skills", "domains", "capabilities", "extensions"
    )
      WHERE target."id" = incoming."id"
        AND (
          target."name", target."endpoint", target."version", target."source_name",
          target."normalized_type", target."source_endpoint", target."endpoint_kind",
          target."endpoint_valid", target."source_version", target."source_digest",
          target."source_kind", target."skills", target."domains", target."capabilities",
          target."extensions"
        ) IS DISTINCT FROM (
          incoming."name", incoming."endpoint", incoming."version", incoming."source_name",
          incoming."normalized_type", incoming."source_endpoint", incoming."endpoint_kind",
          incoming."endpoint_valid", incoming."source_version", incoming."source_digest",
          incoming."source_kind", incoming."skills", incoming."domains", incoming."capabilities",
          incoming."extensions"
        )
    `);
  }
}
export async function updateAgentMetadataInBulk(
  tx: Prisma.TransactionClient,
  updates: AgentMetadataUpdate[],
): Promise<void> {
  if (updates.length === 0) return;
  for (let offset = 0; offset < updates.length; offset += RELATION_UPDATE_BATCH_SIZE) {
    const batch = updates.slice(offset, offset + RELATION_UPDATE_BATCH_SIZE);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "AgentMetadata" AS target SET
      "value" = incoming."value",
      "source_kind" = incoming."source_kind",
      "source_digest" = incoming."source_digest",
      "chain_controlled" = incoming."chain_controlled"
      FROM (VALUES ${Prisma.join(batch.map((update) => Prisma.sql`(
      ${update.id}::integer,
      ${update.value}::text,
      ${update.sourceKind}::text,
      ${update.sourceDigest}::text,
      ${update.chainControlled}::boolean
    )`))}) AS incoming("id", "value", "source_kind", "source_digest", "chain_controlled")
      WHERE target."id" = incoming."id"
        AND (
          target."value", target."source_kind", target."source_digest", target."chain_controlled"
        ) IS DISTINCT FROM (
          incoming."value", incoming."source_kind", incoming."source_digest", incoming."chain_controlled"
        )
    `);
  }
}
export type ChainRelationSet = {
  sourceKind: string;
  sourceDigest: string | null;
  services: ChainServiceRow[];
  metadata: Array<{ key: string; value: string }>;
};
export async function reconcileChainRelationSets(
  tx: Prisma.TransactionClient,
  agentId: number,
  inputs: readonly ChainRelationSet[],
): Promise<void> {
  if (inputs.length === 0) return;
  const inputBySource = new Map<string, ChainRelationSet>();
  for (const input of inputs) inputBySource.set(input.sourceKind, input);
  const sourceKinds = [...inputBySource.keys()];
  const currentServices = await tx.agentService.findMany({
    where: { agentId, sourceKind: { in: sourceKinds } },
  });
  const desiredServices = new Map<string, ChainServiceRow>();
  for (const input of inputBySource.values()) {
    for (const service of input.services) {
      const desired = { ...service, sourceKind: input.sourceKind };
      desiredServices.set(`${input.sourceKind}\0${serviceKey(desired)}`, desired);
    }
  }
  const staleServiceIds: number[] = [];
  const serviceUpdates: AgentServiceUpdate[] = [];
  for (const current of currentServices) {
    const desiredKey = `${current.sourceKind ?? ""}\0${serviceKey(current)}`;
    const desired = desiredServices.get(desiredKey);
    if (!desired) {
      staleServiceIds.push(current.id);
      continue;
    }
    desiredServices.delete(desiredKey);
    if (
      current.sourceName !== desired.sourceName || current.normalizedType !== desired.normalizedType ||
      current.sourceEndpoint !== desired.sourceEndpoint || current.endpointKind !== desired.endpointKind ||
      current.endpointValid !== desired.endpointValid || current.sourceVersion !== desired.sourceVersion ||
      current.sourceDigest !== desired.sourceDigest || current.sourceKind !== desired.sourceKind ||
      !jsonEquivalent(current.skills, desired.skills ?? null) ||
      !jsonEquivalent(current.domains, desired.domains ?? null) ||
      !jsonEquivalent(current.capabilities, desired.capabilities ?? null) ||
      !jsonEquivalent(current.extensions, desired.extensions ?? null)
    ) {
      serviceUpdates.push({
        id: current.id,
        data: {
          ...desired,
          sourceKind: desired.sourceKind,
        },
      });
    }
  }
  await updateAgentServicesInBulk(tx, serviceUpdates);
  if (staleServiceIds.length > 0) {
    await tx.agentService.deleteMany({ where: { id: { in: staleServiceIds } } });
  }
  if (desiredServices.size > 0) {
    await tx.agentService.createMany({
      data: [...desiredServices.values()].map((service) => ({
        agentId,
        ...service,
        skills: stringArray(service.skills),
        domains: stringArray(service.domains),
        capabilities: stringArray(service.capabilities),
        extensions: prismaJson(service.extensions),
      })),
    });
  }
  const currentMetadata = await tx.agentMetadata.findMany({
    where: { agentId, chainControlled: true, sourceKind: { in: sourceKinds } },
  });
  const desiredMetadata = new Map<string, {
    key: string;
    value: string;
    sourceKind: string;
    sourceDigest: string | null;
  }>();
  for (const input of inputBySource.values()) {
    for (const entry of input.metadata) {
      desiredMetadata.set(`${input.sourceKind}\0${entry.key}`, {
        ...entry,
        sourceKind: input.sourceKind,
        sourceDigest: input.sourceDigest,
      });
    }
  }
  const staleMetadataIds: number[] = [];
  const metadataUpdates: AgentMetadataUpdate[] = [];
  for (const current of currentMetadata) {
    const desiredKey = `${current.sourceKind ?? ""}\0${current.key}`;
    const desired = desiredMetadata.get(desiredKey);
    if (!desired) {
      staleMetadataIds.push(current.id);
      continue;
    }
    desiredMetadata.delete(desiredKey);
    if (current.value !== desired.value || current.sourceDigest !== desired.sourceDigest) {
      metadataUpdates.push({
        id: current.id,
        value: desired.value,
        sourceKind: desired.sourceKind,
        sourceDigest: desired.sourceDigest,
        chainControlled: true,
      });
    }
  }
  await updateAgentMetadataInBulk(tx, metadataUpdates);
  if (staleMetadataIds.length > 0) {
    await tx.agentMetadata.deleteMany({ where: { id: { in: staleMetadataIds } } });
  }
  if (desiredMetadata.size > 0) {
    await tx.agentMetadata.createMany({
      data: [...desiredMetadata.values()].map((entry) => ({
        agentId,
        key: entry.key,
        value: entry.value,
        sourceKind: entry.sourceKind,
        sourceDigest: entry.sourceDigest,
        chainControlled: true,
      })),
    });
  }
}
export function reconcileChainRelations(
  tx: Prisma.TransactionClient,
  input: ChainRelationSet & { agentId: number },
): Promise<void> {
  return reconcileChainRelationSets(tx, input.agentId, [input]);
}
