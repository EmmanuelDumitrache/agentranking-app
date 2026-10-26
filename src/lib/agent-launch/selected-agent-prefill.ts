import type { LaunchProfileServiceInput } from "@/lib/agent-launch/launch-profile-enrichment";

export type LaunchSelectedAgentPrefill = {
  readonly agentId: string;
  readonly agentLabel: string;
  readonly tokenName: string;
  readonly tokenSymbol: string;
  readonly tokenDescription: string;
  readonly tokenImageUrl: string;
};

export type LaunchSelectedAgentPrefillSource = {
  readonly agentDbId: number;
  readonly name: string;
  readonly description: string;
  readonly image: string;
};

/** Suggest a ticker from agent name — user can edit before launch. */
export function suggestTokenSymbolFromAgentName(name: string): string {
  const compact = name
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
  if (!compact || compact.length < 2) return "AGENT";
  return compact;
}

export function buildLaunchPrefillFromSelectedAgent(
  agent: LaunchSelectedAgentPrefillSource,
): LaunchSelectedAgentPrefill {
  return {
    agentId: String(agent.agentDbId),
    agentLabel: agent.name,
    tokenName: agent.name,
    tokenSymbol: suggestTokenSymbolFromAgentName(agent.name),
    tokenDescription: agent.description,
    tokenImageUrl: agent.image,
  };
}

export type LaunchSelectedAgentEnrichmentSource = {
  readonly website: string;
  readonly github: string;
  readonly archetype: string;
  readonly capabilityTags: string[];
  readonly services: LaunchProfileServiceInput[];
};

export function buildLaunchEnrichmentFromAgent(
  agent: LaunchSelectedAgentEnrichmentSource,
  launch: {
    profileWebsite?: string | null;
    profileGithub?: string | null;
    profileTags?: string[] | null;
  } | null,
) {
  return {
    website: launch?.profileWebsite?.trim() || agent.website || "",
    github: launch?.profileGithub?.trim() || agent.github || "",
    archetype: agent.archetype || "",
    capabilityTags: launch?.profileTags?.length ? [...launch.profileTags] : [...agent.capabilityTags],
    services: agent.services.length > 0 ? [...agent.services] : [],
  };
}
