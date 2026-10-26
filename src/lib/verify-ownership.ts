/**
 * Checks if a wallet is considered the owner of an agent.
 * Matches both agent.owner and agentWallet from metadata.
 */
export function walletMatchesAgent(
  wallet: string,
  agent: { owner: string; metadata?: Array<{ key: string; value: string }> }
): boolean {
  const w = wallet.toLowerCase();
  if (agent.owner && agent.owner.toLowerCase() === w) return true;
  const agentWallet = agent.metadata?.find((m) => m.key === "agentWallet")?.value?.toLowerCase();
  return !!(agentWallet && agentWallet === w);
}