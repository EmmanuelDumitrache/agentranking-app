import "server-only";
import type {
  AgentTaskProfile,
  AgentTaskDomain,
  AgentTaskComplexity,
} from "./types";
import type { UIMessage } from "ai";
import { estimateTextTokens } from "../run/token-budget";
const TOOL_CATALOG_QUERY_PATTERNS = [
  /^\s*(?:tools?|actions?|functions?|capabilities)\s*[?.!]*\s*$/i,
  /\b(?:list|show|enumerate|describe)\s+(?:me\s+)?(?:(?:all|every)\s+)?(?:of\s+)?(?:the\s+)?(?:(?:your|available|runtime)\s+)?(?:tools?|actions?|capabilities)\b/i,
  /\b(?:what|which)\s+(?:tools?|actions?|capabilities)\s+(?:do\s+you\s+have|are\s+available|can\s+you\s+(?:call|use|access))\b/i,
  /\bwhat\s+can\s+you\s+do\b/i,
  /\byour\s+capabilities\b/i,
  /\b(?:tool|action)\s+catalog\b/i,
  /\bavailable\s+(?:tools?|actions?)\b/i,
  /\b(?:do\s+you\s+have|do\s+you\s+support|can\s+you\s+(?:use|access|call|connect\s+to))\s+(?:mcp|model\s+context\s+protocol)(?:\s+(?:support|tools?|servers?|capabilities))?\b/i,
  /\b(?:what|which|list|show|describe)\s+(?:mcp|model\s+context\s+protocol)\s+(?:tools?|servers?|capabilities)\b/i,
  /^\s*(?:mcp|model\s+context\s+protocol)\s+(?:support|tools?|servers?|capabilities)\s*[?.!]*\s*$/i,
] as const;
const CONTEXT_RETRIEVAL_INTENT = /\b(?:earlier|previous|prior|last\s+time|remember|conversation|thread|we\s+(?:said|decided|discussed)|what\s+did\s+(?:i|we)\s+(?:say|decide|discuss)|stored\s+(?:tool\s+)?(?:result|output)|artifact)\b/i;
const HISTORICAL_VISUAL_REFERENCE = /(?:\b(?:that|this|the|previous|prior|earlier|last|uploaded|attached|shared)\s+(?:image|photo|picture|screenshot|chart|graph|diagram|figure)\b|\b(?:image|photo|picture|screenshot|chart|graph|diagram|figure)\s+(?:i|we)\s+(?:sent|uploaded|attached|shared)\b|\b(?:look\s+at|review|analy[sz]e|inspect|read|check)\s+(?:that|this|the|my|previous|prior|earlier|uploaded|attached)\s+(?:image|photo|picture|screenshot|chart|graph|diagram|figure)\b)/i;
const HISTORICAL_FILE_REFERENCE = /(?:\b(?:that|this|the|previous|prior|earlier|last|uploaded|attached|shared)\s+(?:file|document|pdf|spreadsheet|attachment)\b|\b(?:file|document|pdf|spreadsheet|attachment)\s+(?:i|we)\s+(?:sent|uploaded|attached|shared)\b|\b(?:review|analy[sz]e|inspect|read|check|open)\s+(?:that|this|the|my|previous|prior|earlier|uploaded|attached)\s+(?:file|document|pdf|spreadsheet|attachment)\b)/i;
export function isToolCatalogQuery(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (TOOL_CATALOG_QUERY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return true;
  }

  // MCP capability questions are phrased in many natural ways (for example
  // “list out the tools you have from MCP”). Detect the intent compositionally
  // rather than growing an exact-sentence regex list. This remains a cheap,
  // deterministic classifier and does not invoke another model.
  const lower = normalized.toLowerCase();
  const hasMcpIntent = /\b(?:mcp|model\s+context\s+protocol)\b/.test(lower);
  if (!hasMcpIntent) return false;
  const hasCapabilityNoun = /\b(?:tools?|functions?|actions?|capabilit(?:y|ies)|servers?)\b/.test(lower);
  const hasDiscoveryIntent = /\b(?:list|show|enumerate|describe|what|which|available|have|access|use|support|connected|from|via)\b/.test(lower);
  return hasCapabilityNoun && hasDiscoveryIntent;
}
export type ProfileTaskInput = {
  /** The user's text message */
  text: string;
  /** Full message parts (for attachment detection) */
  parts?: UIMessage["parts"];
  /** Agent metadata */
  agent?: {
    name?: string;
    archetype?: string;
    description?: string;
  };
  /** Current wallet/network context */
  wallet?: {
    publicKey?: string;
    network?: string;
    solBalanceLamports?: bigint;
  };
  /** Whether the selected model supports tools */
  modelHasTools?: boolean;
};
/**
 * Profile an agent chat task deterministically — no LLM calls.
 * Inspects user text, attachment types, agent context, and model capabilities.
 */
export function profileAgentTask(input: ProfileTaskInput): AgentTaskProfile {
  const text = input.text ?? "";
  const lower = text.toLowerCase();
  const normalizedText = normalizeWords(lower);
  const evidence: string[] = [];
  // ── State-changing intent ──
  const stateChangingPatterns = [
    "transfer",
    "swap",
    "trade",
    "stake",
    "unstake",
    "burn",
    "mint",
    "send",
    "deposit",
    "withdraw",
    "borrow",
    "repay",
    "lend",
    "close",
    "cancel",
    "create",
    "launch",
    "deploy",
    "wrap",
    "unwrap",
    "claim",
    "harvest",
    "compound",
    "bridge",
    "purchase",
    "checkout",
    "pay",
    "issue",
    "request card",
    "request a card",
    "request virtual card",
    "request single-use card",
  ];
  const stateChangingIntent = stateChangingPatterns.some((p) =>
    containsPhrase(normalizedText, p),
  );
  if (stateChangingIntent) evidence.push("state_changing_intent");
  // ── Tool catalog enumeration ──
  const catalogQuery = isToolCatalogQuery(text);
  if (catalogQuery) evidence.push("catalog_enumeration");
  // ── Domain detection ──
  const domains = detectDomains(lower, input.agent);
  evidence.push(...domains.map((d) => `domain:${d}`));
  // ── Current/web requirement ──
  const currentWebIndicators = [
    "latest",
    "today",
    "currently",
    "current",
    "recent",
    "recently",
    "newest",
    "news",
    "announcement",
    "announced",
    "this week",
    "this month",
    "as of",
    "now",
    "live",
    "update",
    "release",
    "changelog",
    "breaking",
  ];
  const hasRecencyLanguage = currentWebIndicators.some((w) =>
    containsPhrase(normalizedText, w),
  );
  // Web search: recency language + domain NOT fully on-chain
  const onChainOnlyDomains = new Set<AgentTaskDomain>([
    "balance",
    "wallet",
    "transfer",
    "transaction",
    "general",
  ]);
  const requiresCurrentWeb =
    (hasRecencyLanguage || domains.includes("web")) &&
    !domains.every((d) => onChainOnlyDomains.has(d)) &&
    !catalogQuery;
  // Special case: "current balance" → on-chain, not web
  if (
    hasRecencyLanguage &&
    domains.includes("balance") &&
    domains.every((d) => onChainOnlyDomains.has(d))
  ) {
    evidence.push("current_balance_onchain_preference");
  }
  if (requiresCurrentWeb) evidence.push("requires_current_web");
  // ── Vision requirement ──
  const hasCurrentImageAttachment =
    input.parts?.some(
      (part) => part.type === "file" && part.mediaType?.startsWith("image/"),
    ) ?? false;
  const historicalVisualReference = HISTORICAL_VISUAL_REFERENCE.test(text);
  const historicalFileReference = HISTORICAL_FILE_REFERENCE.test(text);
  const requiresVision = hasCurrentImageAttachment || historicalVisualReference;
  if (hasCurrentImageAttachment) evidence.push("image_attachment");
  if (historicalVisualReference) evidence.push("historical_image_reference");
  if (historicalFileReference) evidence.push("historical_file_reference");
  // ── Tool requirement ──
  const toolPatterns = [
    "analyse",
    "analyze",
    "check",
    "get",
    "fetch",
    "show",
    "display",
    "transfer",
    "swap",
    "trade",
    "stake",
    "unstake",
    "burn",
    "mint",
    "send",
    "deposit",
    "withdraw",
    "borrow",
    "repay",
    "lend",
    "close",
    "cancel",
    "create",
    "launch",
    "deploy",
    "wrap",
    "unwrap",
    "claim",
    "harvest",
    "compound",
    "bridge",
    "purchase",
    "checkout",
    "pay",
    "card",
    "agentcard",
    "balance",
    "price",
    "token",
    "nft",
    "wallet",
    "transaction",
    "mint address",
    "solana address",
    "public key",
    /[1-9A-HJ-NP-Za-km-z]{32,44}/, // Solana base58 address pattern
  ];
  const requiresTools =
    catalogQuery ||
    requiresCurrentWeb ||
    historicalVisualReference ||
    historicalFileReference ||
    CONTEXT_RETRIEVAL_INTENT.test(text) ||
    toolPatterns.some((p) => {
      if (p instanceof RegExp) return p.test(text);
      return containsPhrase(normalizedText, p);
    });
  if (requiresTools) evidence.push("requires_tools");
  // Solana address-like identifier
  if (/[1-9A-HJ-NP-Za-km-z]{32,44}/.test(text)) {
    evidence.push("solana_address_like_identifier");
  }
  // ── Complexity (computed before prefersReasoning so it can reference it) ──
  const complexity = determineComplexity({
    domains,
    requiresTools,
    requiresCurrentWeb,
    requiresVision,
    stateChangingIntent,
    catalogQuery,
    textLength: text.length,
  });
  if (complexity !== "low") evidence.push(`complexity:${complexity}`);
  // ── Reasoning preference ──
  const reasoningPatterns = [
    "analyse",
    "analyze",
    "explain",
    "reason",
    "compare",
    "evaluate",
    "assess",
    "investigate",
    "audit",
    "diagnose",
  ];
  const prefersReasoning =
    reasoningPatterns.some((p) => containsPhrase(normalizedText, p)) || complexity === "high";
  // ── Estimated context tokens ──
  const estimatedContextTokens = estimateTextTokens(text) + 512; // rough + prompt overhead
  return {
    requiresTools,
    requiresCurrentWeb,
    requiresVision,
    prefersReasoning,
    stateChangingIntent,
    catalogQuery,
    domains,
    complexity,
    estimatedContextTokens,
    evidence,
  };
}

function normalizeWords(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsPhrase(normalizedHaystack: string, phrase: string): boolean {
  const normalizedNeedle = normalizeWords(phrase);
  if (!normalizedNeedle) return false;
  return ` ${normalizedHaystack} `.includes(` ${normalizedNeedle} `);
}

function detectDomains(
  text: string,
  agent?: ProfileTaskInput["agent"],
): AgentTaskDomain[] {
  const requestDomains = detectDomainsInText(text);
  if (requestDomains.length > 0) return requestDomains;

  // Creator metadata is intentionally only a fallback when the current request
  // has no domain signal at all. Loading every domain mentioned in a broad
  // persona/description on each turn would make domain guidance and retrieval
  // effectively global rather than progressively disclosed. Prefer one narrow
  // fallback from the concise identity fields, then description, and otherwise
  // stay in the general domain.
  const identityFallback = firstAgentDomain(
    `${agent?.name ?? ""} ${agent?.archetype ?? ""}`,
  );
  if (identityFallback) return [identityFallback];
  const descriptionFallback = firstAgentDomain(agent?.description ?? "");
  return descriptionFallback ? [descriptionFallback] : ["general"];
}

function firstAgentDomain(text: string): AgentTaskDomain | undefined {
  return detectDomainsInText(text).find((domain) => domain !== "general" && domain !== "web");
}

function detectDomainsInText(text: string): AgentTaskDomain[] {
  const domains = new Set<AgentTaskDomain>();
  const lower = text.toLowerCase();
  // Wallet operations
  if (/wallet|public key|airdrop|request airdrop|get wallet/i.test(lower))
    domains.add("wallet");
  // Balance
  if (/balance|how much|portfolio|holdings|lamports|sol balance/i.test(lower))
    domains.add("balance");
  // Token
  if (
    /token|mint|spl|fungible|metaplex|metadata|supply|decimals/i.test(lower)
  )
    domains.add("token");
  if (/[1-9A-HJ-NP-Za-km-z]{32,44}pump\b/i.test(lower)) domains.add("token");
  // Market / price
  if (
    /price|market|chart|candlestick|trending|volume|marketcap|fdv/i.test(
      lower,
    )
  )
    domains.add("market");
  // Transfer
  if (/transfer|send to|move|airdrop/i.test(lower)) domains.add("transfer");
  // Trade / swap
  if (
    /trade|swap|exchange|buy|sell|order|limit|market order|jupiter|orca|raydium/i.test(
      lower,
    )
  )
    domains.add("trade");
  if (/swap/i.test(lower)) domains.add("swap");
  // Staking
  if (
    /stake|unstake|validator|delegat|marinade|jito|earning|yield|apr/i.test(
      lower,
    )
  )
    domains.add("staking");
  // DeFi
  if (
    /defi|lend|borrow|deposit|withdraw|pool|liquidity|farm|yield/i.test(lower)
  )
    domains.add("defi");
  // NFT
  if (/nft|collection|metadata|uri|image.*token|token.*image/i.test(lower))
    domains.add("nft");
  // Launch
  if (
    /launch|deploy.*token|create.*token|pump.*fun|memecoin|new.*token/i.test(
      lower,
    )
  )
    domains.add("launch");
  // Blink
  if (/blink|action.*url|solana.*action/i.test(lower)) domains.add("blink");
  // Transaction
  if (
    /transaction|tx|signature|confirm|block|recent.*blockhash|priority.*fee/i.test(
      lower,
    )
  )
    domains.add("transaction");
  // Web
  if (
    /news|search|find.*information|look.*up|google|wiki|announcement|announced|headline|breaking\snews/i.test(
      lower,
    )
  )
    domains.add("web");
  return Array.from(domains).sort();
}

function determineComplexity(params: {
  domains: AgentTaskDomain[];
  requiresTools: boolean;
  requiresCurrentWeb: boolean;
  requiresVision: boolean;
  stateChangingIntent: boolean;
  catalogQuery: boolean;
  textLength: number;
}): AgentTaskComplexity {
  let score = 0;
  // Multiple domains = more complex
  if (params.domains.length >= 2) score += 1;
  if (params.domains.length >= 3) score += 1;
  // State-changing = more complex
  if (params.stateChangingIntent) score += 1;
  // External/web needed = more complex
  if (params.requiresCurrentWeb) score += 1;
  // Vision needed = more complex
  if (params.requiresVision) score += 1;
  // Catalog enumeration = medium
  if (params.catalogQuery && params.domains.length === 1) score += 1;
  // Long text = more complex
  if (params.textLength > 200) score += 1;
  if (params.textLength > 500) score += 1;
  if (score >= 3) return "high";
  if (score >= 1) return "medium";
  return "low";
}