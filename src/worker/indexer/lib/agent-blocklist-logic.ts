import { parseStrictUnsignedInteger } from "./strict-integer.js";
/** Row shape from Prisma `AgentBlocklistRule` (mirror of webapp `src/lib/agent-blocklist-logic.ts`). */
export type AgentBlocklistRuleRow = {
  id: string;
  matchType: string;
  value: string;
  active: boolean;
};
export type AgentBlocklistProbe = {
  name: string;
  agentURI: string;
  owner: string;
  chainId: number;
  agentId: number;
};
export class AgentBlocklistError extends Error {
  readonly code = "AGENT_BLOCKLISTED" as const;
  constructor(message = "This listing matches a blocklist rule and cannot be stored.") {
    super(message);
    this.name = "AgentBlocklistError";
  }
}
export function normalizeOwnerWallet(addr: string): string {
  return (addr ?? "").trim().toLowerCase();
}
export function parseAgentKey(value: string): { chainId: number; agentId: number } | null {
  const m = /^(\d+):(\d+)$/.exec(value.trim());
  if (!m) return null;
  try {
    return {
      chainId: parseStrictUnsignedInteger(m[1], "blocklist chain id", { maximum: 2_147_483_647 }),
      agentId: parseStrictUnsignedInteger(m[2], "blocklist agent id", { allowZero: true, maximum: 2_147_483_647 }),
    };
  } catch {
    return null;
  }
}
export function matchesBlocklistRule(rule: AgentBlocklistRuleRow, a: AgentBlocklistProbe): boolean {
  if (!rule.active) return false;
  const raw = rule.value?.trim() ?? "";
  if (!raw) return false;
  const v = rule.value;
  const name = a.name ?? "";
  const uri = a.agentURI ?? "";
  const owner = normalizeOwnerWallet(a.owner);
  switch (rule.matchType) {
    case "name_contains":
      return name.toLowerCase().includes(v.toLowerCase());
    case "name_exact":
      return name.trim().toLowerCase() === v.trim().toLowerCase();
    case "uri_contains":
      return uri.toLowerCase().includes(v.toLowerCase());
    case "uri_exact":
      return uri === v;
    case "owner_wallet":
      return owner === normalizeOwnerWallet(v);
    case "agent_key": {
      const p = parseAgentKey(v);
      return p !== null && p.chainId === a.chainId && p.agentId === a.agentId;
    }
    default:
      return false;
  }
}
type CompiledBlocklistRules = {
  nameContains: string[];
  nameExact: Set<string>;
  uriContains: string[];
  uriExact: Set<string>;
  owners: Set<string>;
  agentKeys: Set<string>;
};
const compiledBlocklistRules = new WeakMap<readonly AgentBlocklistRuleRow[], CompiledBlocklistRules>();
function compileBlocklistRules(rules: readonly AgentBlocklistRuleRow[]): CompiledBlocklistRules {
  const cached = compiledBlocklistRules.get(rules);
  if (cached) return cached;
  const compiled: CompiledBlocklistRules = {
    nameContains: [],
    nameExact: new Set(),
    uriContains: [],
    uriExact: new Set(),
    owners: new Set(),
    agentKeys: new Set(),
  };
  for (const rule of rules) {
    if (!rule.active || !rule.value?.trim()) continue;
    switch (rule.matchType) {
      case "name_contains": compiled.nameContains.push(rule.value.toLowerCase()); break;
      case "name_exact": compiled.nameExact.add(rule.value.trim().toLowerCase()); break;
      case "uri_contains": compiled.uriContains.push(rule.value.toLowerCase()); break;
      case "uri_exact": compiled.uriExact.add(rule.value); break;
      case "owner_wallet": compiled.owners.add(normalizeOwnerWallet(rule.value)); break;
      case "agent_key": {
        const parsed = parseAgentKey(rule.value);
        if (parsed) compiled.agentKeys.add(`${parsed.chainId}:${parsed.agentId}`);
        break;
      }
    }
  }
  compiledBlocklistRules.set(rules, compiled);
  return compiled;
}
export function isAgentBlockedByRules(rules: readonly AgentBlocklistRuleRow[], a: AgentBlocklistProbe): boolean {
  if (rules.length === 0) return false;
  const compiled = compileBlocklistRules(rules);
  const name = (a.name ?? "").toLowerCase();
  const uri = a.agentURI ?? "";
  const uriLower = uri.toLowerCase();
  return compiled.nameExact.has(name.trim()) ||
    compiled.nameContains.some((value) => name.includes(value)) ||
    compiled.uriExact.has(uri) ||
    compiled.uriContains.some((value) => uriLower.includes(value)) ||
    compiled.owners.has(normalizeOwnerWallet(a.owner)) ||
    compiled.agentKeys.has(`${a.chainId}:${a.agentId}`);
}
export function assertNotBlocklistedWithRules(rules: readonly AgentBlocklistRuleRow[], a: AgentBlocklistProbe): void {
  if (isAgentBlockedByRules(rules, a)) {
    throw new AgentBlocklistError();
  }
}
