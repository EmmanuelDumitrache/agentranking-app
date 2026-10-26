import { CHAINS, FEATURED_TESTNET_IDS, type ChainConfig } from "@/lib/chains";
import { WAGMI_CHAIN_IDS } from "@/lib/wagmi-chain-ids";
export const LAUNCH_STEPS = [
  { id: 1, label: "Basic Info" },
  { id: 2, label: "Services" },
  { id: 3, label: "Capabilities" },
  { id: 4, label: "Advanced" },
  { id: 5, label: "URI" },
  { id: 6, label: "Networks" },
  { id: 7, label: "Review" },
] as const;
export type LaunchStepId = (typeof LAUNCH_STEPS)[number]["id"];
export type LaunchServiceKind = "MCP" | "A2A" | "OASF" | "CUSTOM";
export interface LaunchServiceEntry {
  id: string;
  kind: LaunchServiceKind;
  endpoint: string;
  mcpTools: string;
  mcpPrompts: string;
  mcpResources: string;
  a2aSkills: string;
}
export const LAUNCH_SERVICE_KINDS: LaunchServiceKind[] = ["MCP", "A2A", "OASF", "CUSTOM"];
export const LAUNCH_SERVICE_HINTS: Record<LaunchServiceKind, string> = {
  MCP: "Model Context Protocol service for AI tools, prompts, and resources.",
  A2A: "Agent-to-Agent protocol endpoint for interoperable agent calls.",
  OASF: "Open Agentic Schema Framework service endpoint.",
  CUSTOM: "Custom HTTP endpoint for proprietary integrations.",
};
export const LAUNCH_SERVICE_PLACEHOLDERS: Record<LaunchServiceKind, string> = {
  MCP: "https://api.example.com/mcp",
  A2A: "https://a2a.example.com/.well-known/agent.json",
  OASF: "https://oasf.example.com",
  CUSTOM: "https://api.example.com/agent",
};
export const LAUNCH_AGENT_TYPES = [
  "General",
  "Trading",
  "DeFi",
  "Analytics",
  "Builders",
  "Security",
  "Social",
  "Gaming",
] as const;
export const LAUNCH_TRUST_OPTIONS = [
  {
    id: "reputation",
    label: "Reputation-based Trust",
    description:
      "Validators provide subjective feedback on agent performance and behavior.",
  },
  {
    id: "crypto-economic",
    label: "Crypto-economic Trust",
    description: "Validators stake tokens to vouch for agent behavior.",
  },
  {
    id: "tee-attestation",
    label: "TEE Attestation Trust",
    description: "Trusted Execution Environment attestation for code integrity.",
  },
] as const;
const TESTNET_CHAIN_IDS = new Set(FEATURED_TESTNET_IDS);
export const SUPPORTED_LAUNCH_CHAINS: ChainConfig[] = [...CHAINS.filter((c) => c.isActive)].sort(
  (a, b) => a.name.localeCompare(b.name),
);
export function canDeployWithWallet(c: ChainConfig): boolean {
  return Boolean(
    c.identityRegistry.startsWith("0x") &&
      WAGMI_CHAIN_IDS.has(c.chainId),
  );
}
export const mainnetLaunchChains = SUPPORTED_LAUNCH_CHAINS.filter(
  (c) => !TESTNET_CHAIN_IDS.has(c.chainId),
);
export const testnetLaunchChains = SUPPORTED_LAUNCH_CHAINS.filter((c) =>
  TESTNET_CHAIN_IDS.has(c.chainId),
);
export function createLaunchService(kind: LaunchServiceKind = "MCP"): LaunchServiceEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    endpoint: "",
    mcpTools: "",
    mcpPrompts: "",
    mcpResources: "",
    a2aSkills: "",
  };
}
export function estimateLaunchGasUsd(chainId: number): string {
  if (chainId === 11155111 || chainId === 84532) return "~$0 (testnet)";
  if (chainId === 8453) return "~$0.003";
  if (chainId === 137) return "~$0.01";
  if (chainId === 56) return "~$0.05";
  return "varies";
}