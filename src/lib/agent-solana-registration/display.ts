/** Whether the agent is listed on the Solana 8004 public directory. */
export function isAgentSolanaDirectoryListed(agent: {
  solanaAssetAddress?: string | null;
  solanaCanonicalStatus?: string | null;
}): boolean {
  if (agent.solanaCanonicalStatus === "registered") return true;
  return Boolean(agent.solanaAssetAddress?.trim());
}
