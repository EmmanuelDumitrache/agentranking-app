import Link from "next/link";
import type { PublicAgentPreview } from "@/lib/public-site/types";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { PublicSiteSection } from "@/components/public-site/public-site-section";
import { AgentPreviewCarousel } from "@/components/public-site/agent-preview-carousel";
type Props = {
  readonly agents: readonly PublicAgentPreview[];
};
export function AgentPreviewSection({ agents }: Props) {
  return (
    <PublicSiteSection
      id="agents"
      eyebrow="AgentRanking-native"
      title="Agents on the launchpad"
      description="Identity, verification, services, wallets, and optional token launches — created inside the AgentRanking app."
      actions={
        <Link href={publicSiteRoutes.agents} className="ui-btn ui-btn-secondary ui-btn-sm whitespace-nowrap">
          View all
        </Link>
      }
    >
      {agents.length === 0 ? (
        <div className="ui-panel ui-panel--stack border-dashed py-10 text-center">
          <p className="text-muted-foreground text-sm">No native agents published yet.</p>
          <Link href={publicSiteRoutes.createAgent} className="ui-btn ui-btn-secondary ui-btn-sm mt-4">
            Create your agent
          </Link>
        </div>
      ) : (
        <AgentPreviewCarousel agents={agents} />
      )}
    </PublicSiteSection>
  );
}
