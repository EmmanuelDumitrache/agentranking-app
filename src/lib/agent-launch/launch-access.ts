import "server-only";
import type { AgentLaunch } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { AgentLaunchError } from "@/lib/agent-launch/errors";
import { isAgentLaunchNetwork } from "@/lib/agent-launch/network";
function assertSupportedLaunchNetwork(network: string) {
  if (!isAgentLaunchNetwork(network)) {
    throw new AgentLaunchError(
      `Launch network must be devnet or mainnet-beta (got ${network})`,
      "invalid_network",
      400,
    );
  }
}
export async function loadAgentLaunchOrThrow(launchId: string): Promise<AgentLaunch> {
  const launch = await prisma.agentLaunch.findUnique({ where: { id: launchId } });
  if (!launch) {
    throw new AgentLaunchError("Launch not found", "launch_not_found", 404);
  }
  return launch;
}
export function isMockOnlyLaunch(
  launch: Pick<AgentLaunch, "feeSharingConfig" | "creationTx" | "mint">,
): boolean {
  return (
    launch.feeSharingConfig?.startsWith("mock") === true ||
    launch.creationTx?.startsWith("mock") === true ||
    launch.mint?.startsWith("devnet-mock-") === true
  );
}
export function assertLaunchDraftReadyForCreate(launch: AgentLaunch) {
  assertSupportedLaunchNetwork(launch.network);
  if (launch.launchStatus !== "draft") {
    throw new AgentLaunchError(
      `Launch status ${launch.launchStatus} cannot build create transaction`,
      "invalid_status",
      400,
    );
  }
  if (!launch.tokenName?.trim() || !launch.tokenSymbol?.trim()) {
    throw new AgentLaunchError(
      "Token name and symbol are required before create",
      "missing_token_details",
      400,
    );
  }
}
export function assertLaunchReadyForFeeShare(launch: AgentLaunch) {
  if (!launch.mint) {
    throw new AgentLaunchError("Mint is required before fee sharing", "missing_mint", 400);
  }
  if (launch.launchStatus !== "token_created" && launch.launchStatus !== "fee_share_pending") {
    throw new AgentLaunchError(
      `Launch status ${launch.launchStatus} cannot build fee-share transaction`,
      "invalid_status",
      400,
    );
  }
}
export function assertLaunchIndexedForInvestorTest(launch: AgentLaunch) {
  assertSupportedLaunchNetwork(launch.network);
  if (launch.launchStatus !== "indexed" || launch.feeSharingStatus !== "active") {
    throw new AgentLaunchError(
      "Launch must be indexed with active fee sharing before investor testing",
      "launch_not_indexed",
      400,
    );
  }
  if (!launch.mint) {
    throw new AgentLaunchError("Launch mint is required", "missing_mint", 400);
  }
  if (isMockOnlyLaunch(launch)) {
    throw new AgentLaunchError(
      "Investor testing is not available for mock-only launches. Complete real on-chain fee routing first.",
      "mock_launch",
      400,
    );
  }
}
export function assertLaunchIndexedForDistribution(launch: AgentLaunch) {
  assertLaunchIndexedForInvestorTest(launch);
}
