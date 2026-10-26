export const OPEN_AGENT_WALLET_EVENT = "ar-dashboard-open-agent-wallet";

export function openDashboardAgentWallet(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OPEN_AGENT_WALLET_EVENT));
}
