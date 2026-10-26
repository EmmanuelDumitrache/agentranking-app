import "server-only";

import type { Session } from "next-auth";
import type { AgentLaunch } from "@/generated/prisma/client";
import { resolveLaunchAgentDbId } from "@/lib/agent-launch/linked-agent";
import { assertLaunchOwnsAgentDbId } from "@/lib/agent-launch/selected-agent";
import {
  getLaunchWalletSession,
  type LaunchWalletSessionData,
} from "@/lib/launch-wallet-session/session";
import { walletsMatch } from "@/lib/launch-wallet-session/wallet-match";

export { assertImmutableCreatorWallet, walletsMatch } from "@/lib/launch-wallet-session/wallet-match";

export type LaunchAccessContext = {
  walletSession: LaunchWalletSessionData | null;
  dashboardSession: Session | null;
};

export async function loadLaunchAccessContext(
  dashboardSession: Session | null,
): Promise<LaunchAccessContext> {
  const walletSession = await getLaunchWalletSession();
  return { walletSession, dashboardSession };
}

export function isWalletQuickLaunch(launch: Pick<AgentLaunch, "agentDbId" | "agentId" | "launchKind">): boolean {
  if (launch.launchKind === "wallet_quick") return true;
  return resolveLaunchAgentDbId(launch) == null && !launch.agentId?.trim();
}

export async function assertAgentLaunchDraftAccess(
  launch: AgentLaunch,
  context: LaunchAccessContext,
): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  const agentDbId = resolveLaunchAgentDbId(launch);

  if (agentDbId != null) {
    const ownership = await assertLaunchOwnsAgentDbId(
      context.dashboardSession,
      String(agentDbId),
    );
    if (!ownership.ok) {
      return {
        ok: false,
        status: ownership.status,
        error: ownership.status === 401 ? "Sign in required for agent launches." : "Forbidden",
      };
    }
    return { ok: true };
  }

  const session = context.walletSession;
  if (!session) {
    return { ok: false, status: 401, error: "Wallet session required for quick launches." };
  }
  if (session.chain !== "solana") {
    return { ok: false, status: 403, error: "Solana wallet session required." };
  }
  if (!launch.creatorWallet?.trim()) {
    return { ok: false, status: 403, error: "Launch has no creator wallet." };
  }
  if (!walletsMatch("solana", session.wallet, launch.creatorWallet)) {
    return { ok: false, status: 403, error: "Wallet does not match launch creator." };
  }
  return { ok: true };
}

export async function assertRobinhoodLaunchWalletAccess(input: {
  creatorWallet: string;
  agentDbId: number | null;
  dashboardSession: Session | null;
  walletSession: LaunchWalletSessionData | null;
}): Promise<{ ok: true } | { ok: false; status: 401 | 403; error: string }> {
  if (input.agentDbId != null) {
    const ownership = await assertLaunchOwnsAgentDbId(
      input.dashboardSession,
      String(input.agentDbId),
    );
    if (!ownership.ok) {
      return {
        ok: false,
        status: ownership.status,
        error: ownership.status === 401 ? "Sign in required." : "Forbidden",
      };
    }
    return { ok: true };
  }

  const session = input.walletSession;
  if (!session) {
    return { ok: false, status: 401, error: "Wallet session required." };
  }
  if (session.chain !== "evm") {
    return { ok: false, status: 403, error: "EVM wallet session required." };
  }
  if (!walletsMatch("evm", session.wallet, input.creatorWallet)) {
    return { ok: false, status: 403, error: "Wallet does not match connected session." };
  }
  return { ok: true };
}
