import { NextResponse } from "next/server";
import { getAgentLaunchFeeDisplayConfig } from "@/lib/agent-launch/config";
import { getMetadataProviderConfig } from "@/lib/agent-launch/metadata-provider";
import { assessAgentLaunchProductionReadiness } from "@/lib/agent-launch/production-readiness";
import { checkKuboReady } from "@/lib/ipfs/kubo";
export const dynamic = "force-dynamic";
/** Launch economics + mainnet readiness + remote Kubo. */
export async function GET() {
  const report = assessAgentLaunchProductionReadiness();
  const feeDisplay = getAgentLaunchFeeDisplayConfig();
  const metadataConfig = getMetadataProviderConfig();
  const kubo = metadataConfig.provider === "ipfs"
    ? await checkKuboReady()
    : { ready: false, reason: "Metadata provider is mock — mainnet tokens cannot launch." };
  const metadataReady = metadataConfig.provider === "ipfs" && kubo.ready;
  return NextResponse.json({
    ok: report.ok && metadataReady,
    network: report.network,
    errors: [
      ...report.errors,
      ...(metadataReady ? [] : [kubo.reason ?? "Kubo metadata provider not ready"]),
    ],
    warnings: report.warnings,
    economics: {
      creatorShareBps: feeDisplay.creatorShareBps,
      platformShareBps: feeDisplay.arShareBps,
      feeShareLabel: feeDisplay.feeShareLabel,
      platformFeeSol: feeDisplay.platformFeeSol,
      initialBuySol: feeDisplay.initialBuySol,
      feeRecipientConfigured: Boolean(feeDisplay.treasury),
    },
    metadataProvider: {
      provider: metadataConfig.provider,
      ready: metadataReady,
      reason: kubo.reason ?? null,
      publicGatewayUrl: metadataConfig.ipfsGateway,
      rpcConfigured: Boolean(metadataConfig.ipfsApiUrl),
      authConfigured: "bearerTokenConfigured" in kubo ? kubo.bearerTokenConfigured : false,
      kuboVersion: "version" in kubo ? kubo.version ?? null : null,
    },
  });
}
