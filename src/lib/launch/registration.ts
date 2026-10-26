import {
  buildAgentDataUri,
  buildRegistrationJson,
  parseCommaList,
  type AgentRegistrationParams,
  type AgentServiceRegistration,
} from "@/lib/build-agent-uri";
import { applyToRegistrationParams } from "@/lib/site-agent-listing-attribution";
import { buildIpfsUri } from "@/lib/ipfs/uri";
import type { LaunchServiceEntry } from "@/lib/launch/constants";
export type LaunchAdvancedState = {
  agentType: string;
  agentTags: string;
  isTEE: boolean;
  stakedAmount: string;
  isActive: boolean;
  x402Support: boolean;
  supportedTrust: string[];
};
export type LaunchCapabilitiesState = {
  oasfSkills: string;
  oasfDomains: string;
};
export function launchServicesToRegistration(
  services: LaunchServiceEntry[],
  capabilities: LaunchCapabilitiesState,
): AgentServiceRegistration[] {
  const rows: AgentServiceRegistration[] = [];
  for (const service of services) {
    if (!service.endpoint.trim()) continue;
    const base: AgentServiceRegistration = {
      name: service.kind,
      endpoint: service.endpoint.trim(),
    };
    if (service.kind === "MCP") {
      const mcpTools = parseCommaList(service.mcpTools);
      const mcpPrompts = parseCommaList(service.mcpPrompts);
      const mcpResources = parseCommaList(service.mcpResources);
      if (mcpTools) base.mcpTools = mcpTools;
      if (mcpPrompts) base.mcpPrompts = mcpPrompts;
      if (mcpResources) base.mcpResources = mcpResources;
    }
    if (service.kind === "A2A") {
      const a2aSkills = parseCommaList(service.a2aSkills);
      if (a2aSkills) base.a2aSkills = a2aSkills;
    }
    if (service.kind === "OASF") {
      const skills = parseCommaList(capabilities.oasfSkills);
      const domains = parseCommaList(capabilities.oasfDomains);
      if (skills) base.skills = skills;
      if (domains) base.domains = domains;
    }
    rows.push(base);
  }
  const skillItems = parseCommaList(capabilities.oasfSkills);
  const domainItems = parseCommaList(capabilities.oasfDomains);
  const hasOasfService = rows.some((row) => row.name.toUpperCase() === "OASF");
  if (!hasOasfService && (skillItems || domainItems)) {
    rows.push({
      name: "OASF",
      endpoint: "",
      ...(skillItems ? { skills: skillItems } : {}),
      ...(domainItems ? { domains: domainItems } : {}),
    });
  }
  return rows;
}
export function buildLaunchRegistrationParams(input: {
  name: string;
  description: string;
  imageUrl: string;
  services: LaunchServiceEntry[];
  capabilities: LaunchCapabilitiesState;
  advanced: LaunchAdvancedState;
}): AgentRegistrationParams {
  const services = launchServicesToRegistration(input.services, input.capabilities);
  const supportedTrust =
    input.advanced.supportedTrust.length > 0 ? input.advanced.supportedTrust : ["reputation"];
  return applyToRegistrationParams({
    name: input.name,
    description: input.description,
    image: input.imageUrl,
    services,
    active: input.advanced.isActive,
    x402Support: input.advanced.x402Support,
    supportedTrust,
  });
}
export function buildLaunchAgentUri(
  input: Parameters<typeof buildLaunchRegistrationParams>[0],
  uriMode: "auto" | "ipfs",
  ipfsUrl: string,
): string {
  const params = buildLaunchRegistrationParams(input);
  if (uriMode === "ipfs" && ipfsUrl.trim()) {
    return buildIpfsUri(ipfsUrl) ?? ipfsUrl.trim();
  }
  return buildAgentDataUri(params);
}
export function buildLaunchRegistrationJson(input: Parameters<typeof buildLaunchRegistrationParams>[0]) {
  return buildRegistrationJson(buildLaunchRegistrationParams(input));
}
export function buildLaunchExtraMetadata(advanced: LaunchAdvancedState): Record<string, string> {
  const extra: Record<string, string> = {};
  if (advanced.agentType) extra.type = advanced.agentType;
  if (advanced.isTEE) extra.tee = "true";
  if (advanced.stakedAmount.trim()) extra.staked = advanced.stakedAmount.trim();
  if (advanced.agentTags.trim()) extra.tags = advanced.agentTags.trim();
  return extra;
}
