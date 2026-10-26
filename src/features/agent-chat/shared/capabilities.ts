/**
 * Product-facing capabilities that AgentRanking chat can honestly claim.
 * Runtime Solana/tool inventories stay dynamic — never hardcode plugin tools here.
 */

export type AgentChatKnownCapabilities = {
  profile: true;
  verification: {
    verified: boolean;
  };
  wallet: {
    linked: boolean;
    /** False means task-scoped prompt projection intentionally omitted identifiers. */
    detailsIncluded: boolean;
    network: "solana" | null;
    publicKey: string | null;
    isCustodial: boolean | null;
  };
  model: {
    tools: boolean;
    webSearch: boolean;
    images: boolean;
  };
  /** Claims the model must never invent without an authoritative discovery result. */
  neverClaimWithoutDiscovery: readonly string[];
};

export const AGENT_CHAT_NEVER_CLAIM_WITHOUT_DISCOVERY = [] as const;

export function buildKnownChatCapabilities(input: {
  verified: boolean;
  walletPublicKey?: string | null;
  walletNetwork?: string | null;
  walletIsCustodial?: boolean | null;
  /** Preserve linked/not-linked capability while omitting task-irrelevant wallet identifiers. */
  includeWalletDetails?: boolean;
  modelTools?: boolean;
  modelWebSearch?: boolean;
  modelImages?: boolean;
}): AgentChatKnownCapabilities {
  const rawPublicKey = input.walletPublicKey?.trim() || null;
  const linked = rawPublicKey != null;
  const includeWalletDetails = input.includeWalletDetails !== false;
  const publicKey = includeWalletDetails ? rawPublicKey : null;
  return {
    profile: true,
    verification: { verified: input.verified },
    wallet: {
      linked,
      detailsIncluded: includeWalletDetails,
      network: linked ? "solana" : null,
      publicKey,
      isCustodial:
        !linked || !includeWalletDetails ? null : input.walletIsCustodial === true,
    },
    model: {
      tools: input.modelTools === true,
      webSearch: input.modelWebSearch === true,
      images: input.modelImages === true,
    },
    neverClaimWithoutDiscovery: AGENT_CHAT_NEVER_CLAIM_WITHOUT_DISCOVERY,
  };
}

/** Short labels for the agent context panel (UI only). */
export function describeKnownCapabilities(
  caps: AgentChatKnownCapabilities,
): Array<{ id: string; label: string; detail?: string }> {
  const items: Array<{ id: string; label: string; detail?: string }> = [
    {
      id: "profile",
      label: "AgentRanking profile",
      detail: "Name, description, and identity from this agent’s listing",
    },
    {
      id: "verification",
      label: caps.verification.verified
        ? "Verified on AgentRanking"
        : "Not verified yet",
      detail: caps.verification.verified
        ? "Ownership / verification signals are available as context"
        : "Verification can be completed from the agent Verification page",
    },
  ];

  if (caps.wallet.linked) {
    items.push({
      id: "wallet",
      label: "Solana wallet linked",
      detail: caps.wallet.publicKey
        ? (caps.wallet.isCustodial
          ? `Custodial wallet · ${shortKey(caps.wallet.publicKey)} · balance / send SOL / recent transfers`
          : `Linked wallet · ${shortKey(caps.wallet.publicKey)}`)
        : "Wallet details are omitted from this task-scoped projection",
    });
  } else {
    items.push({
      id: "wallet",
      label: "No Solana wallet linked",
      detail: "Wallet tools stay unavailable until a wallet is provisioned",
    });
  }

  if (caps.model.tools) {
    items.push({
      id: "tools",
      label: "Runtime tools (model supports tools)",
      detail:
        "Exact actions come from the live catalog — ask “what tools do you have?”",
    });
  } else {
    items.push({
      id: "tools",
      label: "Text-only model",
      detail: "This model cannot call runtime tools",
    });
  }

  if (caps.model.webSearch) {
    items.push({
      id: "web",
      label: "Web search",
      detail: "Available when the provider exposes it for this model",
    });
  }

  if (caps.model.images) {
    items.push({
      id: "images",
      label: "Vision / images",
      detail: "This model can accept image inputs when attached",
    });
  }

  return items;
}

function shortKey(key: string): string {
  if (key.length <= 12) return key;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
