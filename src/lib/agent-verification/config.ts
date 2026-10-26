/** Resolve the agent verification fee in SOL from environment. Defaults to 0.1 SOL. */
export function resolveVerificationFeeSol(): number {
  const raw = process.env.AGENT_VERIFICATION_FEE_SOL?.trim();
  if (!raw) return 0.1;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.1;
}
import { resolveAgentRankingFeeRecipientWallet } from "@/lib/agent-launch/fees";
/** Resolve the verification treasury wallet, defaulting to the platform fee recipient. */
export function resolveVerificationTreasury(): string {
  const raw = process.env.AGENT_VERIFICATION_TREASURY_WALLET?.trim();
  if (raw) return raw;
  return resolveAgentRankingFeeRecipientWallet();
}
