import { NetworksClient } from "./networks-client";
import { readPublicNetworkSummaries } from "@/lib/agent-directory/network-summaries.server";
export const dynamic = "force-dynamic";
export default async function NetworksPage() {
  const initialNetworks = await readPublicNetworkSummaries();
  return <NetworksClient initialNetworks={initialNetworks} />;
}
