import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NativeAgentDetailPage } from "@/components/public-site/native-agent-detail-page";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { resolvePublicAgentRoute } from "@/lib/agent-public-route.server";
import { loadNativeAgentDetailData } from "@/lib/public-site/native-agent-detail-data.server";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { agentSocialOgImageUrl } from "@/lib/social-og-images";

export type PublicAgentDetailRouteProps = {
  readonly params: Promise<{
    readonly chainId: string;
    readonly agentId: string;
    readonly slug: string;
  }>;
};

function notFoundMetadata(): Metadata {
  return {
    title: "Agent not found | AgentRanking",
    robots: { index: false, follow: true },
  };
}

export async function generatePublicAgentDetailMetadata({
  params,
}: PublicAgentDetailRouteProps): Promise<Metadata> {
  const { chainId, agentId, slug } = await params;
  const resolved = await resolvePublicAgentRoute({
    rawChainId: chainId,
    rawAgentId: agentId,
    requestedSlug: slug,
  });
  if (!resolved) return notFoundMetadata();

  try {
    const data = await loadNativeAgentDetailData(
      resolved.identity.chainId,
      resolved.identity.agentId,
    );
    const title = `${resolved.identity.name} | AgentRanking`;
    const description =
      data.description?.trim() ||
      `View ${resolved.identity.name} — AgentRanking AI agent profile, verification, score, and linked tokens.`;
    return publicSitePageMetadata({
      title,
      description,
      path: resolved.canonicalPath,
      imageUrl: agentSocialOgImageUrl(
        resolved.identity.chainId,
        resolved.identity.agentId,
      ),
    });
  } catch {
    return notFoundMetadata();
  }
}

export async function PublicAgentDetailRoute({ params }: PublicAgentDetailRouteProps) {
  const { chainId, agentId, slug } = await params;
  const resolved = await resolvePublicAgentRoute({
    rawChainId: chainId,
    rawAgentId: agentId,
    requestedSlug: slug,
  });
  if (!resolved) return notFound();

  const loaded = await loadNativeAgentDetailData(
    resolved.identity.chainId,
    resolved.identity.agentId,
  );
  const data = {
    ...loaded,
    name: resolved.identity.name,
    isActive: resolved.identity.isActive,
  };

  return (
    <PublicSitePageShell>
      <NativeAgentDetailPage agent={data} />
    </PublicSitePageShell>
  );
}
