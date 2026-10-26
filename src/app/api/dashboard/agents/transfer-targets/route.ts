import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { loadAgentWalletSolBalanceLamports } from "@/lib/dashboard/agent-overview";
import {
  fetchEthereumMainnetEthBalance,
  fetchRobinhoodChainEthBalance,
} from "@/lib/evm-wallet-utils";
export const dynamic = "force-dynamic";
export type AgentTransferTarget = {
  agentDbId: number;
  name: string;
  image: string | null;
  solAddress: string | null;
  solBalanceSol: number | null;
  evmAddress: string | null;
  evmBalanceEthMainnet: number | null;
  evmBalanceEthRobinhood: number | null;
};
/**
 * GET /api/dashboard/agents/transfer-targets?excludeAgentId=123
 * Sibling agent wallets owned by the signed-in user (for send-to-agent pickers).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await getDashboardAccess(session);
  if (!access.signedIn) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const excludeRaw = request.nextUrl.searchParams.get("excludeAgentId");
  const excludeAgentId = excludeRaw ? Number.parseInt(excludeRaw, 10) : Number.NaN;
  const ownedIds = access.ownedAgents
    .map((a) => a.id)
    .filter((id) => !Number.isFinite(excludeAgentId) || id !== excludeAgentId);
  if (ownedIds.length === 0) {
    return NextResponse.json({ agents: [] as AgentTransferTarget[] });
  }
  const rows = await prisma.agent.findMany({
    where: { id: { in: ownedIds } },
    select: {
      id: true,
      name: true,
      image: true,
      evmWalletAddress: true,
      evmWalletStatus: true,
      agentWallet: { select: { publicKey: true } },
    },
    orderBy: { name: "asc" },
  });
  const agents = await mapWithConcurrency(
    rows,
    4,
    async (row): Promise<AgentTransferTarget> => {
      const solAddress = row.agentWallet?.publicKey?.trim() || null;
      const evmAddress =
        row.evmWalletStatus === "active" && row.evmWalletAddress?.trim()
          ? row.evmWalletAddress.trim()
          : null;
      const [solLamports, mainnetBal, rhBal] = await Promise.all([
        solAddress
          ? loadAgentWalletSolBalanceLamports(solAddress).catch(() => null)
          : Promise.resolve(null),
        evmAddress
          ? fetchEthereumMainnetEthBalance(evmAddress).catch(() => null)
          : Promise.resolve(null),
        evmAddress
          ? fetchRobinhoodChainEthBalance(evmAddress).catch(() => null)
          : Promise.resolve(null),
      ]);
      return {
        agentDbId: row.id,
        name: row.name,
        image: row.image || null,
        solAddress,
        solBalanceSol:
          solLamports != null && Number.isFinite(solLamports)
            ? solLamports / 1e9
            : null,
        evmAddress,
        evmBalanceEthMainnet: mainnetBal
          ? Number.parseFloat(mainnetBal.ether)
          : null,
        evmBalanceEthRobinhood: rhBal ? Number.parseFloat(rhBal.ether) : null,
      };
    },
  );
  return NextResponse.json({
    agents: agents.filter((a) => a.solAddress || a.evmAddress),
  });
}
