/**
 * Bounded registration JSON fetch for agent footprint reads.
 * IPFS references use private Kubo RPC; HTTPS reads use DNS-pinned public transport.
 */
import { fetchRegistrationDocument } from "@/lib/registration-document";

export type AgentRegistrationJson = {
  type?: string;
  name?: string;
  description?: string;
  image?: string;
  services?: Array<{ name?: string; endpoint?: string; version?: string }>;
  endpoints?: Array<{ name?: string; endpoint?: string; version?: string }>;
  x402Support?: boolean;
  registrations?: Array<{ agentId?: number; agentRegistry?: string; chainId?: number }>;
  mcpTools?: string[];
  tokenAddress?: string;
  customTags?: string | string[];
};

export async function fetchAgentRegistrationJson(
  uri: string,
  timeoutMs = 8_000,
): Promise<AgentRegistrationJson | null> {
  return fetchRegistrationDocument<AgentRegistrationJson>(uri, {
    httpsTimeoutMs: timeoutMs,
  });
}
