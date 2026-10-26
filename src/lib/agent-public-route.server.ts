import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { isAgentBlocked } from "@/lib/agent-blocklist";
import { validatePublicAgentSlug } from "@/lib/agent-public-route-core";
import {
  recordAgentRouteNotFound,
  recordAgentRouteSlugMismatch,
  recordAgentRouteSuccess,
  startAgentRouteIdentityLookupTimer,
} from "@/lib/agent-public-route-metrics.server";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
import { agentPublicPath } from "@/lib/agent-public-url";
import { getDevCovenantPreviewRouteIdentity } from "@/lib/dev-covenant-preview-agent";
export { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";

export type PublicAgentRouteIdentity = {
  id: number;
  chainId: number;
  agentId: number;
  name: string;
  publiclyActive: boolean;
  moderationStatus: string;
  administrativeActiveOverride: boolean | null;
  sourceActive: boolean | null;
  isActive: boolean;
};

type PublicAgentRouteProbe =
  | { status: "ok"; identity: PublicAgentRouteIdentity }
  | { status: "missing_agent" | "not_public" | "blocked" };

/** Cheap unique-identity read plus direct public-eligibility checks. */
const loadPublicAgentRouteProbe = cache(
  async (chainId: number, agentId: number): Promise<PublicAgentRouteProbe> => {
    const stopTimer = startAgentRouteIdentityLookupTimer();
    try {
      const preview = getDevCovenantPreviewRouteIdentity(chainId, agentId);
      if (preview) {
        return {
          status: "ok",
          identity: {
            ...preview,
            publiclyActive: true,
            moderationStatus: "active",
            administrativeActiveOverride: null,
            sourceActive: true,
            isActive: true,
          },
        };
      }

      const row = await prisma.agent.findUnique({
        where: { agentId_chainId: { agentId, chainId } },
        select: {
          id: true,
          chainId: true,
          agentId: true,
          name: true,
          publiclyActive: true,
          moderationStatus: true,
          administrativeActiveOverride: true,
          sourceActive: true,
          isActive: true,
          agentURI: true,
          owner: true,
        },
      });
      if (!row) return { status: "missing_agent" };
      if (!row.isActive || !row.publiclyActive) return { status: "not_public" };
      if (
        await isAgentBlocked({
          name: row.name,
          agentURI: row.agentURI,
          owner: row.owner,
          chainId: row.chainId,
          agentId: row.agentId,
        })
      ) {
        return { status: "blocked" };
      }

      const { agentURI: _agentURI, owner: _owner, ...identity } = row;
      return { status: "ok", identity };
    } finally {
      stopTimer();
    }
  },
);

/** Request-deduplicated public identity loader for server consumers. */
export const loadPublicAgentRouteIdentity = cache(
  async (chainId: number, agentId: number): Promise<PublicAgentRouteIdentity | null> => {
    const result = await loadPublicAgentRouteProbe(chainId, agentId);
    return result.status === "ok" ? result.identity : null;
  },
);

type ResolvedPublicAgentRoute = {
  identity: PublicAgentRouteIdentity;
  canonicalSlug: string;
  canonicalPath: string;
};

const resolvePublicAgentRouteCached = cache(
  async (
    rawChainId: string,
    rawAgentId: string,
    requestedSlug: string,
  ): Promise<ResolvedPublicAgentRoute | null> => {
    const chainId = parsePublicChainId(rawChainId);
    if (chainId == null) {
      recordAgentRouteNotFound("invalid_chain_id");
      return null;
    }

    const agentId = parsePublicAgentId(rawAgentId);
    if (agentId == null) {
      recordAgentRouteNotFound("invalid_agent_id");
      return null;
    }

    const routeProbe = await loadPublicAgentRouteProbe(chainId, agentId);
    if (routeProbe.status !== "ok") {
      recordAgentRouteNotFound(routeProbe.status);
      return null;
    }
    const { identity } = routeProbe;

    const slugValidation = validatePublicAgentSlug({
      requestedSlug,
      currentName: identity.name,
    });
    if (!slugValidation.ok) {
      recordAgentRouteNotFound(slugValidation.reason);
      if (slugValidation.reason !== "malformed_slug") {
        recordAgentRouteSlugMismatch(slugValidation.reason);
      }
      return null;
    }

    recordAgentRouteSuccess();
    return {
      identity,
      canonicalSlug: slugValidation.canonicalSlug,
      canonicalPath: agentPublicPath(identity),
    };
  },
);

/** Resolve and instrument one canonical route at most once per React server request. */
export function resolvePublicAgentRoute(input: {
  rawChainId: string;
  rawAgentId: string;
  requestedSlug: string;
}): Promise<ResolvedPublicAgentRoute | null> {
  return resolvePublicAgentRouteCached(
    input.rawChainId,
    input.rawAgentId,
    input.requestedSlug,
  );
}
