import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { normalizedAgentServiceData } from "@/lib/agent-service-normalization";
import { metadataKeysForLinkType } from "@/lib/dashboard/official-links";
import { revalidateAgentByDbId } from "@/lib/dashboard/revalidate-agent-by-db-id.server";
import { normalizeProfileTagsInput } from "@/lib/agent-launch/launch-profile";
import {
  normalizeGithubUrl,
  normalizeLaunchCapabilityTags,
  normalizeLaunchProfileServices,
  normalizeWebsiteUrl,
  type LaunchProfileEnrichmentFields,
  type LaunchProfileServiceInput,
} from "@/lib/agent-launch/launch-profile-enrichment";
import { normalizeOptionalWebsiteUrl } from "@/lib/public-media-url";
import { normalizeTwitterUrl, normalizeTelegramUrl } from "@/lib/agent-launch/metadata-token-json";
import { enqueueAgentSignalSync } from "@/jobs/producer";

const ALLOWED_ARCHETYPES = new Set([
  "",
  "trading",
  "arbitrage",
  "sniper",
  "yield",
  "builder",
  "analytics",
  "bridge",
  "copy_trader",
  "social",
  "mev",
  "telegram",
]);

export type ApplyLaunchProfileEnrichmentInput = LaunchProfileEnrichmentFields & {
  twitter?: string;
  telegram?: string;
  tokenImageUrl?: string;
  tokenName?: string;
  tokenDescription?: string;
};

async function upsertAgentMetadata(agentId: number, key: string, value: string) {
  const existing = await prisma.agentMetadata.findFirst({ where: { agentId, key } });
  if (existing) {
    await prisma.agentMetadata.update({ where: { id: existing.id }, data: { value } });
    return;
  }
  await prisma.agentMetadata.create({ data: { agentId, key, value } });
}

async function deleteAgentMetadata(agentId: number, keys: string[]) {
  if (keys.length === 0) return;
  await prisma.agentMetadata.deleteMany({ where: { agentId, key: { in: keys } } });
}

async function upsertOfficialLink(
  agentDbId: number,
  linkType: "website" | "x" | "telegram" | "github",
  url: string | null,
) {
  const metadataKeys = metadataKeysForLinkType(linkType);
  if (!url) {
    await prisma.agentOfficialLink.deleteMany({
      where: { agentId: agentDbId, linkType },
    });
    await deleteAgentMetadata(agentDbId, metadataKeys);
    return;
  }
  await prisma.agentOfficialLink.upsert({
    where: { agentId_linkType: { agentId: agentDbId, linkType } },
    create: {
      agentId: agentDbId,
      linkType,
      url,
      status: "submitted",
      lockedByVerifiedOwner: false,
    },
    update: { url, status: "submitted" },
  });
  for (const key of metadataKeys) {
    await upsertAgentMetadata(agentDbId, key, url);
  }
}

async function syncDashboardServices(
  agentDbId: number,
  services: LaunchProfileServiceInput[],
) {
  const existing = await prisma.agentService.findMany({
    where: { agentId: agentDbId, sourceKind: "dashboard" },
    select: { id: true, name: true, endpoint: true },
  });
  const desired = services.filter((s) => s.name.trim() && s.endpoint.trim());
  const desiredKeys = new Set(
    desired.map((s) => `${s.name.trim().toLowerCase()}|${s.endpoint.trim().toLowerCase()}`),
  );
  for (const row of existing) {
    const key = `${row.name.trim().toLowerCase()}|${row.endpoint.trim().toLowerCase()}`;
    if (!desiredKeys.has(key)) {
      await prisma.agentService.delete({ where: { id: row.id } });
    }
  }
  for (const service of desired) {
    const normalized = normalizedAgentServiceData(
      {
        name: service.name,
        endpoint: service.endpoint,
        version: service.version ?? "",
      },
      { sourceKind: "dashboard" },
    );
    const match = existing.find(
      (row) =>
        row.name.trim().toLowerCase() === service.name.trim().toLowerCase() &&
        row.endpoint.trim().toLowerCase() === service.endpoint.trim().toLowerCase(),
    );
    if (match) {
      await prisma.agentService.update({
        where: { id: match.id },
        data: {
          ...normalized,
          extensions: normalized.extensions as never,
        },
      });
      continue;
    }
    await prisma.agentService.create({
      data: {
        agentId: agentDbId,
        ...normalized,
        extensions: normalized.extensions as never,
      },
    });
  }
}

export function sanitizeLaunchProfileEnrichmentInput(
  body: Record<string, unknown>,
): ApplyLaunchProfileEnrichmentInput {
  const website =
    typeof body.website === "string"
      ? normalizeOptionalWebsiteUrl(body.website)
      : "";
  const github =
    typeof body.github === "string" ? (normalizeGithubUrl(body.github) ?? body.github.trim()) : "";
  const archetype =
    typeof body.archetype === "string" ? body.archetype.trim().toLowerCase() : "";
  if (!ALLOWED_ARCHETYPES.has(archetype)) {
    throw new Error("Invalid archetype");
  }
  return {
    website,
    github,
    archetype,
    capabilityTags: normalizeLaunchCapabilityTags(body.capabilityTags),
    services: normalizeLaunchProfileServices(body.services),
    twitter: typeof body.twitter === "string" ? body.twitter.trim() : undefined,
    telegram: typeof body.telegram === "string" ? body.telegram.trim() : undefined,
    tokenImageUrl: typeof body.tokenImageUrl === "string" ? body.tokenImageUrl.trim() : undefined,
    tokenName: typeof body.tokenName === "string" ? body.tokenName.trim() : undefined,
    tokenDescription:
      typeof body.tokenDescription === "string" ? body.tokenDescription.trim() : undefined,
  };
}

export async function applyLaunchProfileEnrichment(
  agentDbId: number,
  launchId: string | null,
  input: ApplyLaunchProfileEnrichmentInput,
): Promise<void> {
  const website = normalizeWebsiteUrl(input.website);
  const github = normalizeGithubUrl(input.github);
  const twitter = normalizeTwitterUrl(input.twitter);
  const telegram = normalizeTelegramUrl(input.telegram);
  const tags = normalizeProfileTagsInput(input.capabilityTags);

  if (launchId) {
    const launchPatch: Prisma.AgentLaunchUpdateInput = {
      profileWebsite: website,
      profileGithub: github,
      profileTwitter: twitter,
      profileTelegram: telegram,
      profileTags: tags,
      profileAvatarUrl: input.tokenImageUrl?.trim() || undefined,
      profileDisplayName: input.tokenName?.trim() || undefined,
      profileShortDescription: input.tokenDescription?.trim()?.slice(0, 280) || undefined,
      profileLongDescription: input.tokenDescription?.trim() || undefined,
    };
    await prisma.agentLaunch.update({
      where: { id: launchId },
      data: launchPatch,
    });
  }

  const agentPatch: Prisma.AgentUpdateInput = {};
  if (input.archetype) {
    agentPatch.archetype = input.archetype;
    agentPatch.archetypeAuto = false;
  }
  if (Object.keys(agentPatch).length > 0) {
    await prisma.agent.update({ where: { id: agentDbId }, data: agentPatch });
  }

  await Promise.all([
    upsertOfficialLink(agentDbId, "website", website),
    upsertOfficialLink(agentDbId, "x", twitter),
    upsertOfficialLink(agentDbId, "telegram", telegram),
    upsertOfficialLink(agentDbId, "github", github),
    syncDashboardServices(agentDbId, input.services),
  ]);

  await prisma.agentMetadata.deleteMany({
    where: { agentId: agentDbId, key: "capability_tag" },
  });
  for (const tag of tags) {
    await prisma.agentMetadata.create({
      data: { agentId: agentDbId, key: "capability_tag", value: tag },
    });
  }

  await revalidateAgentByDbId(agentDbId);
  void enqueueAgentSignalSync(agentDbId).catch((error) => {
    console.warn("[applyLaunchProfileEnrichment] signal sync enqueue failed", error);
  });
}
