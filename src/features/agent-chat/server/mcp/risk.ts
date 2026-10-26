import "server-only";

import type { McpProviderManifest } from "./provider-registry";
import type { McpToolDefinition, McpToolRisk } from "./types";

const RANK: Record<McpToolRisk, number> = {
  READ_ONLY: 0,
  ANALYTICS_QUERY: 1,
  TRANSACTION_PREPARE: 2,
  WRITE_OFFCHAIN: 3,
  INFRA_ADMIN: 4,
  TRADE: 5,
  SIGN: 6,
  BROADCAST: 7,
  PAYMENT: 8,
  CUSTODY: 9,
  UNKNOWN: 10,
};

export const GENERIC_MCP_HARD_BLOCK_RISKS = new Set<McpToolRisk>([
  "SIGN",
  "BROADCAST",
  "PAYMENT",
  "CUSTODY",
]);

export function maxMcpRisk(...risks: Array<McpToolRisk | null | undefined>): McpToolRisk {
  return risks.reduce<McpToolRisk>(
    (highest, risk) => risk && RANK[risk] > RANK[highest] ? risk : highest,
    "READ_ONLY",
  );
}

function searchableTool(tool: McpToolDefinition): string {
  return [
    tool.name,
    tool.title,
    tool.description,
    JSON.stringify(tool.inputSchema),
    JSON.stringify(tool.outputSchema ?? null),
  ].filter(Boolean).join(" ").toLowerCase();
}

export function schemaRequestsWalletSecret(schema: unknown): boolean {
  let serialized = "";
  try {
    serialized = JSON.stringify(schema);
  } catch {
    return true;
  }
  return /(?:private[_ -]?key|mnemonic|seed[_ -]?(?:phrase|words)?|wallet[_ -]?export|raw[_ -]?signing[_ -]?key)/i.test(serialized);
}

export function inferMcpToolRisk(tool: McpToolDefinition): {
  risk: McpToolRisk;
  reason: string;
} {
  const text = searchableTool(tool);
  const lexicalText = text.replace(/[_-]+/g, " ");
  if (schemaRequestsWalletSecret(tool.inputSchema)) {
    return { risk: "CUSTODY", reason: "Input schema requests wallet or signing secret material." };
  }
  if (/(?:private\s*key|mnemonic|seed\s*(?:phrase|words)|wallet\s*export|raw\s*signing\s*key)/i.test(lexicalText)) {
    return {
      risk: "CUSTODY",
      reason: "Untrusted tool metadata requests or describes wallet secret material.",
    };
  }
  if (/(?:send\s*raw\s*transaction|submit\s*transaction|broadcast|relay\s*transaction)/i.test(lexicalText)) {
    return { risk: "BROADCAST", reason: "Tool can submit or broadcast a transaction." };
  }
  if (/(?:\bsign\b|signature|typed\s*data|personal\s*sign)/i.test(lexicalText)) {
    return { risk: "SIGN", reason: "Tool can request or produce a cryptographic signature." };
  }
  if (/(?:custody|create\s*wallet|export\s*wallet|manage\s*wallet|key\s*management)/i.test(lexicalText)) {
    return { risk: "CUSTODY", reason: "Tool concerns wallet, key, or custody administration." };
  }
  if (/(?:x402|\bpayment\b|\bpay\b|purchase|charge\s*credits?)/i.test(lexicalText)) {
    return { risk: "PAYMENT", reason: "Tool can cause a payment or provider charge." };
  }
  const transactionMaterial = /(?:unsigned\s*transaction|transaction\s*request|calldata|slippage|gas\s*limit|gas\s*price|nonce|allowance|permit|approval\s*transaction)/i.test(lexicalText);
  const transactionMutation = /(?:^|[^a-z0-9])(?:transfer|send|withdraw|deposit|approve|permit)(?:$|[^a-z0-9])/i.test(lexicalText);
  if (
    /(?:^|[^a-z0-9])(?:get|list|find|fetch|quote|route|price|estimate)(?:$|[^a-z0-9])/i.test(lexicalText)
    && !transactionMaterial
    && !transactionMutation
  ) {
    return { risk: "READ_ONLY", reason: "Tool retrieves a quote, route, price, or other read-only financial view." };
  }
  // A swap/bridge builder that only returns calldata or an unsigned request is
  // preparation, not authority to initiate the economic action. Keep that
  // distinction so the transaction-preparation kill switch and native handoff
  // apply to every builder regardless of financial verbs in its name.
  if (transactionMaterial || transactionMutation) {
    return { risk: "TRANSACTION_PREPARE", reason: "Tool prepares or describes an unsigned transaction." };
  }
  if (/(?:swap|trade|\border\b|\bbuy\b|\bsell\b|bridge|stake|unstake|borrow|repay|liquidat)/i.test(lexicalText)) {
    return { risk: "TRADE", reason: "Tool describes a trade, swap, bridge, or economic position change." };
  }
  if (/(?:create|update|delete|deploy|verify|webhook|api\s*key|project|configure|publish|write|transfer|withdraw|deposit|approve)/i.test(lexicalText)) {
    const infra = /(?:webhook|api\s*key|project|rpc|endpoint|deploy|verify\s*contract)/i.test(lexicalText);
    return {
      risk: infra ? "INFRA_ADMIN" : "WRITE_OFFCHAIN",
      reason: infra
        ? "Tool can administer external infrastructure."
        : "Tool can create, update, or delete external state.",
    };
  }
  if (/(?:query|analytics|sql|dataset|report|search|screen|historical)/i.test(lexicalText)) {
    return { risk: "ANALYTICS_QUERY", reason: "Tool runs an analytics or potentially metered query." };
  }
  return { risk: "READ_ONLY", reason: "No mutation or financial indicators were found locally." };
}

function serverAnnotationRisk(tool: McpToolDefinition): McpToolRisk {
  const annotations = tool.annotations;
  if (!annotations) return "READ_ONLY";
  if (annotations.destructiveHint === true) return "WRITE_OFFCHAIN";
  if (annotations.openWorldHint === true && annotations.readOnlyHint !== true) return "UNKNOWN";
  // MCP's readOnlyHint is a positive assertion. An explicit false means the
  // server is warning that the call may modify state, so it must raise—not
  // merely fail to lower—the local classification.
  if (annotations.readOnlyHint === false) return "WRITE_OFFCHAIN";
  return "READ_ONLY";
}

export type McpRiskClassification = {
  providerRisk: McpToolRisk | null;
  inferredRisk: McpToolRisk;
  effectiveRisk: McpToolRisk;
  blocked: boolean;
  quarantined: boolean;
  reason: string;
};

export function classifyMcpTool(params: {
  tool: McpToolDefinition;
  manifest: McpProviderManifest | null;
}): McpRiskClassification {
  const inferred = inferMcpToolRisk(params.tool);
  const matchingRules = params.manifest?.curatedToolRules.filter((rule) => {
    rule.namePattern.lastIndex = 0;
    return rule.namePattern.test(params.tool.name);
  }) ?? [];
  const providerRisk = matchingRules.reduce<McpToolRisk | null>(
    (risk, rule) => maxMcpRisk(risk, rule.risk),
    params.manifest?.baselineRisk ?? null,
  );
  const unreviewedFinancialOrSigning = !params.manifest
    && ["TRANSACTION_PREPARE", "TRADE", "SIGN", "BROADCAST", "PAYMENT", "CUSTODY"]
      .includes(inferred.risk);
  const effectiveRisk = params.manifest
    ? maxMcpRisk(providerRisk, inferred.risk, serverAnnotationRisk(params.tool))
    : unreviewedFinancialOrSigning
      ? inferred.risk
      : "UNKNOWN";
  const hardBlocked = GENERIC_MCP_HARD_BLOCK_RISKS.has(effectiveRisk);
  const ruleBlocked = matchingRules.some((rule) => rule.block);
  const secretSchema = schemaRequestsWalletSecret(params.tool.inputSchema);
  const ruleReasons = matchingRules.map((rule) => rule.reason);
  return {
    providerRisk,
    inferredRisk: inferred.risk,
    effectiveRisk,
    blocked: hardBlocked || ruleBlocked || unreviewedFinancialOrSigning,
    quarantined: secretSchema || hardBlocked || ruleBlocked || unreviewedFinancialOrSigning,
    reason: [
      ...ruleReasons,
      inferred.reason,
      unreviewedFinancialOrSigning
        ? "Financial or signing behavior from an unreviewed server requires explicit review."
        : "",
      hardBlocked ? `${effectiveRisk} is blocked in the generic MCP execution path.` : "",
    ].filter(Boolean).join(" ").slice(0, 500),
  };
}

export function mcpRiskIsStateChanging(risk: McpToolRisk): boolean {
  return !["READ_ONLY", "ANALYTICS_QUERY"].includes(risk);
}

export function mcpRiskRequiresApproval(
  risk: McpToolRisk,
  approvalMode: "AUTO_READ_ONLY" | "CONFIRM_MUTATIONS" | "CONFIRM_EVERY_CALL" | "BLOCK_ALL",
): boolean {
  if (approvalMode === "CONFIRM_EVERY_CALL") return true;
  if (approvalMode === "CONFIRM_MUTATIONS") return risk !== "READ_ONLY";
  if (approvalMode === "AUTO_READ_ONLY") {
    return !["READ_ONLY", "ANALYTICS_QUERY"].includes(risk);
  }
  return true;
}
