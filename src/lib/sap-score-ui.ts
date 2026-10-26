/** Avoid importing AgentDetail from client bundle — use minimal shape for helpers. */
export type SapBackedAgentLike = {
  sapVerified?: boolean;
  sapTwinMatch?: boolean;
  sapStats?: unknown;
};
export function isSapBackedProfile(agent: SapBackedAgentLike): boolean {
  return agent.sapVerified === true || agent.sapTwinMatch === true;
}
export type SapProfileUiAgent = SapBackedAgentLike & {
  sapAgentPda?: string | null;
  sapProtocols?: string[] | null;
  sapX402Endpoint?: string | null;
};
/** SAP-specific detail UI (verified, twin, or indexed PDA without full verify flag). */
export function hasSapProfileUi(agent: SapProfileUiAgent): boolean {
  return isSapBackedProfile(agent) || Boolean(agent.sapAgentPda?.trim());
}
