import type { DashboardMcpProvider } from "@/features/agent-chat/shared/mcp-dashboard-types";
import {
  listMcpProviderManifests,
  toPublicMcpProvider,
} from "@/features/agent-chat/server/mcp/provider-registry";
import {
  evaluateMcpConnectionPlatformPolicy,
  listActiveMcpAdminRules,
} from "@/features/agent-chat/server/mcp/platform-policy";

export type DashboardMcpProviderCatalog = {
  providers: DashboardMcpProvider[];
  customAllowed: boolean;
};

export async function getDashboardMcpProviderCatalog(
  appAccountId: string,
): Promise<DashboardMcpProviderCatalog> {
  const rules = await listActiveMcpAdminRules();
  const providers = listMcpProviderManifests()
    .map((provider) => {
      const endpointOrigins = [...new Set([
        provider.endpoint.kind === "fixed"
          ? new URL(provider.endpoint.url).origin
          : "https://template.invalid",
        ...(provider.endpointVariants ?? [])
          .map((variant) => new URL(variant.endpoint.url).origin),
      ])];
      const decisions = endpointOrigins.map((endpointOrigin) =>
        evaluateMcpConnectionPlatformPolicy({
          phase: "create",
          appAccountId,
          providerKey: provider.key,
          endpointOrigin,
          rules,
        }));
      const allowed = decisions.some((decision) => decision.allowed);
      const blockedReason = decisions.find((decision) => !decision.allowed)?.reason;
      const publicProvider = toPublicMcpProvider(provider);
      return {
        ...publicProvider,
        connectable: publicProvider.connectable && allowed,
        unavailableReason: allowed
          ? publicProvider.unavailableReason
          : blockedReason ?? "Connections are disabled by platform policy",
      };
    });
  const customAllowed = evaluateMcpConnectionPlatformPolicy({
    phase: "create",
    appAccountId,
    providerKey: null,
    endpointOrigin: "https://custom.invalid",
    rules,
  }).allowed;

  return { providers, customAllowed };
}
