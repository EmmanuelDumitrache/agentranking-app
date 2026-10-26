"use client";
import { useRouter } from "next/navigation";
import { DashboardAgentEditPanel } from "@/components/dashboard/agent-edit-panel";
import type {
  OfficialLinkMetadataRow,
  OfficialLinkServiceRow,
  ResolvedOfficialLink,
} from "@/lib/dashboard/official-links";
import type { VersionManifest } from "@/lib/agent-version-manifest";
type Props = Readonly<{
  agentDbId: number;
  agentName: string;
  agentImage: string;
  description: string;
  archetype: string;
  tokenAddress: string;
  initialMetadata: OfficialLinkMetadataRow[];
  initialServices: OfficialLinkServiceRow[];
  initialResolvedLinks: ResolvedOfficialLink[];
  initialSavedLinkTypes: string[];
  initialVersionManifest: VersionManifest;
}>;
export function DashboardSocialModule({
  agentDbId,
  agentName,
  agentImage,
  description,
  archetype,
  tokenAddress,
  initialMetadata,
  initialServices,
  initialResolvedLinks,
  initialSavedLinkTypes,
  initialVersionManifest,
}: Props) {
  const router = useRouter();
  return (
    <div className="ui-agent-profile-page ui-dashboard-overview mx-auto w-full max-w-5xl min-w-0 space-y-4 px-4 py-6 sm:px-6">
      <div className="ui-overview-summary overflow-hidden rounded-xl">
        <div className="ui-overview-identity px-4 py-3.5 sm:px-5">
          <h1>Agent profile</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage how {agentName} appears publicly, including profile details,
            links, and version history.
          </p>
        </div>
      </div>
      <DashboardAgentEditPanel
        agentDbId={agentDbId}
        name={agentName}
        image={agentImage}
        description={description}
        archetype={archetype}
        tokenAddress={tokenAddress}
        initialMetadata={initialMetadata}
        initialServices={initialServices}
        initialResolvedLinks={initialResolvedLinks}
        initialSavedLinkTypes={initialSavedLinkTypes}
        initialVersionManifest={initialVersionManifest}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
