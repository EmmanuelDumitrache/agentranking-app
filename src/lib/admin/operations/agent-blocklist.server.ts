import "server-only";

import {
  AGENT_BLOCKLIST_PRISMA_STALE,
  getAgentBlocklistRuleDelegate,
} from "@/lib/agent-blocklist";
import {
  AdminOperationsReadError,
  requireAdminOperationsSession,
} from "./auth.server";

export async function readAdminAgentBlocklist() {
  await requireAdminOperationsSession();
  const delegate = getAgentBlocklistRuleDelegate();
  if (!delegate) {
    throw new AdminOperationsReadError(503, AGENT_BLOCKLIST_PRISMA_STALE);
  }
  const rules = await delegate.findMany({ orderBy: { createdAt: "desc" } });
  return {
    rules: rules.map((rule) => ({
      id: rule.id,
      matchType: rule.matchType,
      value: rule.value,
      active: rule.active,
      note: rule.note,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    })),
  };
}
