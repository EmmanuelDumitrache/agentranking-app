import "server-only";
import type { AgentBlocklistRule, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  type AgentBlocklistProbe,
  type AgentBlocklistRuleRow,
  assertNotBlocklistedWithRules,
  extendAgentWhereNotBlockedFromRules,
  isAgentBlockedByRules,
  whereAgentMatchesRule,
} from "@/lib/agent-blocklist-logic";
export {
  AgentBlocklistError,
  type AgentBlocklistProbe,
  type AgentBlocklistRuleRow,
  isAgentBlockedByRules,
  whereAgentMatchesRule,
} from "@/lib/agent-blocklist-logic";
/** Message when the generated client predates `AgentBlocklistRule` (run `pnpm exec prisma generate` + redeploy). */
export const AGENT_BLOCKLIST_PRISMA_STALE =
  "Prisma client is missing AgentBlocklistRule — run `pnpm exec prisma generate` and redeploy (migrations must include the blocklist tables).";
export type AgentBlocklistRulePrismaDelegate = {
  findMany: (args: Prisma.AgentBlocklistRuleFindManyArgs) => Promise<AgentBlocklistRule[]>;
  create: (args: Prisma.AgentBlocklistRuleCreateArgs) => Promise<AgentBlocklistRule>;
  update: (args: Prisma.AgentBlocklistRuleUpdateArgs) => Promise<AgentBlocklistRule>;
};
/** `null` if `prisma generate` was not run after adding the model (avoids `undefined.findMany` crashes). */
export function getAgentBlocklistRuleDelegate(): AgentBlocklistRulePrismaDelegate | null {
  const raw = Reflect.get(prisma as object, "agentBlocklistRule");
  if (!raw || typeof (raw as { findMany?: unknown }).findMany !== "function") {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[agent-blocklist] ${AGENT_BLOCKLIST_PRISMA_STALE}`);
    }
    return null;
  }
  return raw as AgentBlocklistRulePrismaDelegate;
}
async function fetchActiveRulesFromDb(): Promise<AgentBlocklistRuleRow[]> {
  const delegate = getAgentBlocklistRuleDelegate();
  if (!delegate) return [];
  return delegate.findMany({
    where: { active: true },
    select: { id: true, matchType: true, value: true, active: true },
  });
}
/** Active moderation rules are always read directly; writes take effect immediately. */
export async function loadActiveBlocklistRules(): Promise<AgentBlocklistRuleRow[]> {
  return fetchActiveRulesFromDb();
}

/** Resolve the current set of blocked Agent primary keys for SQL-backed aggregate queries. */
export async function loadBlockedAgentIds(): Promise<number[]> {
  const rules = await loadActiveBlocklistRules();
  if (rules.length === 0) return [];
  const matches = rules
    .map(whereAgentMatchesRule)
    .filter((where): where is Prisma.AgentWhereInput => where !== null);
  if (matches.length === 0) return [];
  const rows = await prisma.agent.findMany({
    where: { OR: matches },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function isAgentBlocked(agent: AgentBlocklistProbe): Promise<boolean> {
  const rules = await loadActiveBlocklistRules();
  return isAgentBlockedByRules(rules, agent);
}
export async function extendAgentWhereNotBlocked(
  base: Prisma.AgentWhereInput,
  _opts?: { useCache?: boolean },
): Promise<Prisma.AgentWhereInput> {
  const rules = await loadActiveBlocklistRules();
  return extendAgentWhereNotBlockedFromRules(rules, base);
}
export async function assertNotBlocklisted(agent: AgentBlocklistProbe): Promise<void> {
  const rules = await loadActiveBlocklistRules();
  assertNotBlocklistedWithRules(rules, agent);
}
