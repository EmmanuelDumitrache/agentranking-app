import { notFound } from "next/navigation";
import { AgentLaunchCommandCenterClient } from "@/components/agent-launch/agent-launch-command-center-client";
import { loadAgentLaunchCommandCenterSnapshot } from "@/lib/agent-launch/command-center-data";
import { agentLaunchCommandCenterEnabled } from "@/lib/agent-launch/guards";
export const dynamic = "force-dynamic";
export default async function AgentLaunchCommandCenterPage() {
  if (!agentLaunchCommandCenterEnabled()) {
    notFound();
  }
  const snapshot = await loadAgentLaunchCommandCenterSnapshot();
  return (
    <div className="container max-w-6xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Launch Command Center</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Local/devnet control panel for Agent Launch smoke tests and observability. Not available
          in production.
        </p>
      </div>
      <AgentLaunchCommandCenterClient snapshot={snapshot} />
    </div>
  );
}
