import "server-only";
import { getAgentLaunchFeeDisplayConfig } from "@/lib/agent-launch/config";
import { readLaunchWalletSessionSnapshot } from "@/lib/launch-wallet-session/snapshot.server";
import { loadOpenPublicMetaplexAttempt } from "@/lib/public-launch/metaplex-quick-launch.server";
import type { PublicLaunchChain } from "@/lib/public-launch/initial-state";
import { getRobinhoodFactoryLaunchFee } from "@/lib/robinhood-chain/prepare-launch.server";

export async function readPublicQuickLaunchInitialState(input: {
  chain: PublicLaunchChain;
  attemptId?: string | null;
}) {
  const [walletSession, robinhoodFee, feeDisplay] = await Promise.all([
    readLaunchWalletSessionSnapshot(),
    getRobinhoodFactoryLaunchFee(),
    Promise.resolve(getAgentLaunchFeeDisplayConfig()),
  ]);
  const openMetaplexAttempt =
    input.chain === "metaplex" &&
    walletSession.authenticated &&
    walletSession.chain === "solana" &&
    walletSession.wallet
      ? await loadOpenPublicMetaplexAttempt(walletSession.wallet, input.attemptId)
      : null;
  return {
    walletSession,
    robinhoodLaunchFeeEth: robinhoodFee.launchFeeEth,
    feeDisplay,
    openMetaplexAttempt,
  };
}
