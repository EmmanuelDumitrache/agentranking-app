import type { AgentLaunch } from "@/generated/prisma/client";
import { AGENT_LAUNCH_PASSPORT_SCHEMA } from "@/lib/agent-launch/constants";
import { LOCAL_TEST_AGENT_ID } from "@/lib/agent-launch/constants-local";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import {
  findDemoLaunchTemplateForLaunch,
  mergeDemoPassportOverrides,
} from "@/lib/agent-launch/demo-templates";
import { resolvePassportInference } from "@/lib/inference-providers/passport";
export type AgentPassport = {
  schema: typeof AGENT_LAUNCH_PASSPORT_SCHEMA;
  network: "solana-devnet";
  launchSource: "AgentRanking";
  agentId: string | null;
  agentName: string;
  token: {
    name: string;
    symbol: string;
    mint: string | null;
    quoteSymbol: string;
  };
  creator: {
    wallet: string | null;
  };
  creatorFeeRouting: {
    enabled: boolean;
    creatorBps: number;
    agentRankingBps: number;
    treasury: string | null;
    sharingConfig: string | null;
  };
  capabilities: {
    mcp: { ready: boolean; endpoint: string | null };
    x402: { ready: boolean; endpoint: string | null };
    api: { ready: boolean; endpoint: string | null };
    github: { ready: boolean; repo: string | null };
  };
  inference: {
    providerId: string | null;
    providerName: string | null;
    endpoint: string | null;
    x402DescriptorUrl: string | null;
    mcpPackage: string | null;
    mcpCompatible: boolean;
    x402Compatible: boolean;
  };
  analytics: {
    apiCallsTracked: boolean;
    launchIndexed: boolean;
  };
  provenance: {
    creationTx: string | null;
    feeShareTx: string | null;
    createdAt: string;
  };
};
export type BuildPassportInput = {
  launch: Pick<
    AgentLaunch,
    | "agentId"
    | "tokenName"
    | "tokenSymbol"
    | "mint"
    | "quoteSymbol"
    | "creatorWallet"
    | "creatorShareBps"
    | "arShareBps"
    | "feeSharingConfig"
    | "feeSharingStatus"
    | "launchStatus"
    | "creationTx"
    | "feeShareTx"
    | "createdAt"
    | "arTreasuryWallet"
  >;
  agentName?: string;
  passportOverrides?: Record<string, unknown>;
};
export function agentLaunchDisplayName(launch: Pick<AgentLaunch, "agentId" | "tokenName">): string {
  const tokenName = launch.tokenName?.trim();
  if (launch.agentId === LOCAL_TEST_AGENT_ID || launch.agentId?.startsWith("demo:")) {
    return tokenName || "Local Test Agent";
  }
  return tokenName || "Unnamed Agent";
}
function storedPassportOverrides(launch: AgentLaunch): Record<string, unknown> | undefined {
  const stored = launch.passportJson;
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return undefined;
  const passport = stored as Partial<AgentPassport>;
  const overrides: Record<string, unknown> = {};
  if (typeof passport.agentName === "string" && passport.agentName.trim()) {
    overrides.agentName = passport.agentName;
  }
  if (passport.capabilities && typeof passport.capabilities === "object") {
    overrides.capabilities = passport.capabilities;
  }
  if (passport.inference && typeof passport.inference === "object") {
    overrides.inference = passport.inference;
  }
  if (typeof passport.analytics?.apiCallsTracked === "boolean") {
    overrides.analytics = { apiCallsTracked: passport.analytics.apiCallsTracked };
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}
export function buildAgentPassportFromLaunch(launch: AgentLaunch): AgentPassport {
  const template = findDemoLaunchTemplateForLaunch(launch);
  return buildAgentPassportPreview({
    launch,
    agentName: template?.passportOverrides.agentName,
    passportOverrides: storedPassportOverrides(launch),
  });
}
function routingEnabledFromLaunch(launch: AgentLaunch): boolean {
  return launch.feeSharingStatus === "active";
}
function routingEnabledFromPassport(stored: AgentPassport): boolean {
  return stored.creatorFeeRouting?.enabled === true;
}
export function isStoredAgentPassportStale(
  launch: AgentLaunch,
  stored: AgentPassport | Record<string, unknown> | null,
): boolean {
  if (launch.launchStatus !== "draft" && !stored) {
    return true;
  }
  if (!stored || typeof stored !== "object") {
    return launch.launchStatus !== "draft";
  }
  const passport = stored as AgentPassport;
  const expectedRouting = routingEnabledFromLaunch(launch);
  const storedRouting = routingEnabledFromPassport(passport);
  if (launch.mint && passport.token?.mint !== launch.mint) {
    return true;
  }
  if (expectedRouting !== storedRouting) {
    return true;
  }
  if (launch.launchStatus === "indexed" && passport.analytics?.launchIndexed !== true) {
    return true;
  }
  if (launch.creationTx && passport.provenance?.creationTx !== launch.creationTx) {
    return true;
  }
  if (launch.feeShareTx && passport.provenance?.feeShareTx !== launch.feeShareTx) {
    return true;
  }
  if (launch.tokenName?.trim() && !passport.token?.name?.trim()) {
    return true;
  }
  if (launch.tokenSymbol?.trim() && !passport.token?.symbol?.trim()) {
    return true;
  }
  if (
    launch.feeSharingConfig &&
    passport.creatorFeeRouting?.sharingConfig !== launch.feeSharingConfig
  ) {
    return true;
  }
  const demoTemplate = findDemoLaunchTemplateForLaunch(launch);
  if (demoTemplate) {
    const expected = buildAgentPassportPreview({
      launch: { ...launch, agentId: demoTemplate.demoAgentId },
      agentName: demoTemplate.passportOverrides.agentName,
      passportOverrides: demoTemplate.passportOverrides,
    });
    if (passport.agentId !== expected.agentId) {
      return true;
    }
    if (JSON.stringify(passport.capabilities) !== JSON.stringify(expected.capabilities)) {
      return true;
    }
    if (passport.analytics?.apiCallsTracked !== expected.analytics.apiCallsTracked) {
      return true;
    }
  }
  return false;
}
export function resolveAgentPassportForDisplay(launch: AgentLaunch): AgentPassport {
  const stored = launch.passportJson as AgentPassport | null;
  if (stored && !isStoredAgentPassportStale(launch, stored)) {
    return stored;
  }
  return buildAgentPassportFromLaunch(launch);
}
export function buildAgentPassportPreview(input: BuildPassportInput): AgentPassport {
  const config = getAgentLaunchConfig();
  const { launch } = input;
  const feeSharingActive = launch.feeSharingStatus === "active";
  const indexed = launch.launchStatus === "indexed";
  const demoTemplate = findDemoLaunchTemplateForLaunch(launch);
  const effectiveAgentId = demoTemplate?.demoAgentId ?? launch.agentId;
  const mergedOverrides = mergeDemoPassportOverrides(launch, input.passportOverrides);
  const inferenceFromOverrides = resolvePassportInference(mergedOverrides?.inference);
  const base: AgentPassport = {
    schema: AGENT_LAUNCH_PASSPORT_SCHEMA,
    network: "solana-devnet",
    launchSource: "AgentRanking",
    agentId: effectiveAgentId,
    agentName:
      input.agentName ??
      (typeof mergedOverrides?.agentName === "string"
        ? mergedOverrides.agentName
        : agentLaunchDisplayName({ ...launch, agentId: effectiveAgentId })),
    token: {
      name: launch.tokenName ?? "",
      symbol: launch.tokenSymbol ?? "",
      mint: launch.mint,
      quoteSymbol: launch.quoteSymbol || "SOL",
    },
    creator: {
      wallet: launch.creatorWallet,
    },
    creatorFeeRouting: {
      enabled: feeSharingActive,
      creatorBps: launch.creatorShareBps,
      agentRankingBps: launch.arShareBps,
      treasury: launch.arTreasuryWallet ?? config.treasury,
      sharingConfig: launch.feeSharingConfig,
    },
    capabilities: {
      mcp: { ready: false, endpoint: null },
      x402: { ready: false, endpoint: null },
      api: { ready: false, endpoint: null },
      github: { ready: false, repo: null },
    },
    inference: inferenceFromOverrides,
    analytics: {
      apiCallsTracked: false,
      launchIndexed: indexed,
    },
    provenance: {
      creationTx: launch.creationTx,
      feeShareTx: launch.feeShareTx,
      createdAt: launch.createdAt.toISOString(),
    },
  };
  if (inferenceFromOverrides.providerId) {
    if (inferenceFromOverrides.x402Compatible && inferenceFromOverrides.x402DescriptorUrl) {
      base.capabilities.x402 = { ready: true, endpoint: inferenceFromOverrides.x402DescriptorUrl };
    }
    if (inferenceFromOverrides.mcpCompatible && inferenceFromOverrides.endpoint) {
      base.capabilities.mcp = {
        ready: true,
        endpoint: `${inferenceFromOverrides.endpoint.replace(/\/$/, "")}/mcp`,
      };
    }
  }
  if (mergedOverrides && typeof mergedOverrides === "object") {
    const overrides = mergedOverrides;
    const capOverrides =
      typeof overrides.capabilities === "object" && overrides.capabilities
        ? (overrides.capabilities as Partial<AgentPassport["capabilities"]>)
        : null;
    const inferenceOverride = resolvePassportInference(overrides.inference);
    const analyticsOverrides =
      typeof overrides.analytics === "object" && overrides.analytics
        ? (overrides.analytics as Partial<AgentPassport["analytics"]>)
        : null;
    return {
      ...base,
      agentName:
        typeof overrides.agentName === "string" ? overrides.agentName : base.agentName,
      capabilities: capOverrides
        ? {
            mcp: { ...base.capabilities.mcp, ...capOverrides.mcp },
            x402: { ...base.capabilities.x402, ...capOverrides.x402 },
            api: { ...base.capabilities.api, ...capOverrides.api },
            github: { ...base.capabilities.github, ...capOverrides.github },
          }
        : base.capabilities,
      inference: inferenceOverride.providerId ? inferenceOverride : base.inference,
      analytics: {
        ...base.analytics,
        ...(typeof analyticsOverrides?.apiCallsTracked === "boolean"
          ? { apiCallsTracked: analyticsOverrides.apiCallsTracked }
          : {}),
      },
    };
  }
  return base;
}
export function mockMetadataUri(launchId: string): string {
  return `mock://metadata/${launchId}`;
}
export function mockPassportUri(launchId: string): string {
  return `mock://passport/${launchId}`;
}
