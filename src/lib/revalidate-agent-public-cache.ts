import { revalidatePath, revalidateTag } from "next/cache";
import { agentPublicPath } from "@/lib/agent-public-url";
import { agentPublicAgentCacheTag } from "@/lib/agent-public-cache-tag";
import { invalidatePublicApiCache } from "@/lib/public-api-cache";
import { agentPayloadCacheDomain } from "@/lib/public-cache-domains";
/**
 * Bust Next.js ISR (`revalidate` on agent pages) after admin or owner updates so
 * localhost/production profiles refresh without waiting for the segment TTL.
 */
export async function revalidateAgentPublicCache(
  chainId: number,
  onChainAgentId: number,
  name: string,
  previousName?: string | null,
): Promise<void> {
  try {
    revalidateTag(agentPublicAgentCacheTag(chainId, onChainAgentId), "max");
    const names = new Set([name, previousName].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    ));
    if (names.size === 0) names.add("agent");
    for (const routeName of names) {
      revalidatePath(
        agentPublicPath({ chainId, agentId: onChainAgentId, name: routeName }),
        "page",
      );
    }
  } catch (e) {
    /* Next.js 16: revalidate* often throws from Route Handlers in dev (no incremental cache). */
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[revalidateAgentPublicCache] revalidate skipped (agent pages may be stale until refresh in prod, or use dev no-cache — see agent-detail-server):",
        Error.isError(e) ? e.message : e,
      );
    }
  }
  await invalidatePublicApiCache(agentPayloadCacheDomain(chainId, onChainAgentId));
  const { invalidatePublicAgentProfileCaches } = await import(
    "@/lib/invalidate-public-statistics"
  );
  await invalidatePublicAgentProfileCaches();
}
