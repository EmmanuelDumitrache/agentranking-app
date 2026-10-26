import "server-only";
import { tool, type ToolSet } from "ai";
import { PublicKey } from "@solana/web3.js";
import {
  SolanaAgentKit,
  KeypairWallet,
  executeAction,
  type Action,
  type BaseWallet,
  type Config,
  type Plugin,
} from "solana-agent-kit";
import { getAgentLaunchConfig } from "@/lib/agent-launch/config";
import {
  parseAgentLaunchNetwork,
  resolveAgentLaunchRpcUrl,
} from "@/lib/agent-launch/network";
import { getWalletBalances } from "./wallet-balance";
import { loadAllPlugins } from "./catalog";
import { loadAgentCustodialKeypair } from "@/lib/custodial-wallet/sign-launch";
import { agentToolContextSchema, requireAgentToolContext } from "./context";
import { markToolEffect } from "./tool-effects";
import { redactSensitiveText } from "@/lib/security/sensitive-data-redaction";
let toolsPromise: Promise<ToolSet> | null = null;
const kitCache = new Map<
  string,
  { expiresAt: number; kit: SolanaAgentKit; network: string }
>();
const KIT_CACHE_MAX_ENTRIES = 128;
function optionalNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function priorityLevel(
  value: string | undefined,
): Config["PRIORITY_LEVEL"] | undefined {
  if (value === "medium" || value === "high" || value === "veryHigh") {
    return value;
  }
  return undefined;
}
function buildAgentKitConfig(): Config {
  return {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY,
    JUPITER_REFERRAL_ACCOUNT: process.env.JUPITER_REFERRAL_ACCOUNT,
    JUPITER_FEE_BPS: optionalNumber(process.env.JUPITER_FEE_BPS),
    FLASH_PRIVILEGE: process.env.FLASH_PRIVILEGE,
    FLEXLEND_API_KEY: process.env.FLEXLEND_API_KEY,
    HELIUS_API_KEY: process.env.HELIUS_API_KEY,
    PRIORITY_LEVEL: priorityLevel(
      process.env.SOLANA_PRIORITY_LEVEL ?? process.env.PRIORITY_LEVEL,
    ),
    SOLUTIOFI_API_KEY: process.env.SOLUTIOFI_API_KEY,
    ALLORA_API_KEY: process.env.ALLORA_API_KEY,
    ALLORA_API_URL: process.env.ALLORA_API_URL,
    ALLORA_NETWORK: process.env.ALLORA_NETWORK,
    ELFA_AI_API_KEY: process.env.ELFA_AI_API_KEY,
    COINGECKO_PRO_API_KEY: process.env.COINGECKO_PRO_API_KEY,
    COINGECKO_DEMO_API_KEY: process.env.COINGECKO_DEMO_API_KEY,
    MESSARI_API_KEY: process.env.MESSARI_API_KEY,
    OKX_API_KEY: process.env.OKX_API_KEY,
    OKX_SECRET_KEY: process.env.OKX_SECRET_KEY,
    OKX_API_PASSPHRASE: process.env.OKX_API_PASSPHRASE,
    OKX_PROJECT_ID: process.env.OKX_PROJECT_ID,
    PUMP_FUN_REFERRAL_WALLET: process.env.PUMP_FUN_REFERRAL_WALLET,
    MAGIC_EDEN_API_KEY: process.env.MAGIC_EDEN_API_KEY,
  };
}
async function getAgentKit(
  agentDbId: number,
  plugins: readonly Plugin[],
): Promise<{
  kit: SolanaAgentKit;
  network: string;
  wallet: string;
  isCustodial: boolean;
}> {
  const balances = await getWalletBalances(agentDbId);
  if (!balances.publicKey) {
    throw new Error("No Solana wallet is linked to this agent");
  }
  const network = parseAgentLaunchNetwork(getAgentLaunchConfig().network);
  const rpcUrl = resolveAgentLaunchRpcUrl(network);
  const cacheKey = `${network}:${balances.publicKey}`;
  const now = Date.now();
  for (const [key, entry] of kitCache) {
    if (entry.expiresAt <= now) kitCache.delete(key);
  }
  const cached = kitCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    kitCache.delete(cacheKey);
    kitCache.set(cacheKey, cached);
    return {
      kit: cached.kit,
      network: cached.network,
      wallet: balances.publicKey,
      isCustodial: balances.isCustodial,
    };
  }
  let wallet: BaseWallet;
  let isCustodial = false;
  const keypair = await loadAgentCustodialKeypair(agentDbId);
  if (keypair) {
    wallet = new KeypairWallet(keypair, rpcUrl);
    isCustodial = true;
  } else {
    // Non-custodial: create a read-only wallet adapter inline.
    // Write actions will throw when the SDK wallet attempts to sign.
    const publicKey = new PublicKey(balances.publicKey);
    wallet = {
      publicKey,
      signTransaction: async () => {
        throw new Error("Agent wallet is not custodial — cannot sign transactions");
      },
      signAllTransactions: async () => {
        throw new Error("Agent wallet is not custodial — cannot sign transactions");
      },
      signAndSendTransaction: async () => {
        throw new Error("Agent wallet is not custodial — cannot sign transactions");
      },
      signMessage: async () => {
        throw new Error("Agent wallet is not custodial — cannot sign messages");
      },
    };
  }
  const kit = new SolanaAgentKit(wallet, rpcUrl, buildAgentKitConfig());
  for (const plugin of plugins) kit.use(plugin);
  kitCache.delete(cacheKey);
  kitCache.set(cacheKey, {
    expiresAt: Date.now() + 30_000,
    kit,
    network,
  });
  while (kitCache.size > KIT_CACHE_MAX_ENTRIES) {
    const oldest = kitCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    kitCache.delete(oldest);
  }
  return { kit, network, wallet: balances.publicKey, isCustodial };
}
function actionDescription(action: Action): string {
  const aliases = action.similes.length
    ? `\nAliases: ${action.similes.join(", ")}`
    : "";
  return `${action.description}${aliases}`.slice(0, 1_024);
}

const SOLANA_READ_ACTION_TOKENS = new Set([
  "analyze",
  "balance",
  "calculate",
  "check",
  "details",
  "estimate",
  "fetch",
  "find",
  "get",
  "info",
  "inspect",
  "list",
  "lookup",
  "metadata",
  "price",
  "query",
  "quote",
  "read",
  "resolve",
  "search",
  "simulate",
  "status",
]);
const SOLANA_HARD_MUTATION_ACTION_TOKENS = new Set([
  "add",
  "airdrop",
  "approve",
  "borrow",
  "burn",
  "cancel",
  "claim",
  "close",
  "create",
  "delete",
  "deploy",
  "deposit",
  "execute",
  "launch",
  "lend",
  "lock",
  "mint",
  "open",
  "place",
  "register",
  "remove",
  "repay",
  "revoke",
  "send",
  "set",
  "sign",
  "stake",
  "submit",
  "tip",
  "unlock",
  "unstake",
  "update",
  "vote",
  "withdraw",
]);
const SOLANA_TRANSFER_ACTION_TOKENS = new Set([
  "bridge",
  "buy",
  "purchase",
  "sell",
  "swap",
  "trade",
  "transfer",
]);
const SOLANA_READ_QUALIFIER_TOKENS = new Set([
  "account",
  "accounts",
  "details",
  "estimate",
  "history",
  "info",
  "metadata",
  "orders",
  "positions",
  "price",
  "quote",
  "rate",
  "rates",
  "rewards",
  "simulate",
  "status",
  "transactions",
]);

function actionNameTokens(action: Action): readonly string[] {
  return action.name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Solana Agent Kit exposes read and write actions through the same Action
 * interface. Classify only unmistakable query-style names as read-only. Any
 * ambiguous action remains state-changing so approval/idempotency and durable
 * mutation evidence are never weakened merely to save context tokens.
 */
function solanaActionStateChanging(action: Action): boolean {
  const tokens = actionNameTokens(action);
  const hasReadIntent = tokens.some((token) => SOLANA_READ_ACTION_TOKENS.has(token));
  const hasReadQualifier = tokens.some((token) => SOLANA_READ_QUALIFIER_TOKENS.has(token));
  const hasReadPrefix = tokens[0] != null && SOLANA_READ_ACTION_TOKENS.has(tokens[0]);

  // Some domain nouns are also mutation verbs (mint, stake, open, claim). A
  // clear query prefix plus a result-oriented qualifier disambiguates common
  // names such as get_mint_metadata/get_stake_accounts/get_open_orders. Do not
  // apply this exception when the action merely contains a read-ish noun.
  if (hasReadPrefix && hasReadQualifier) return false;

  if (tokens.some((token) => SOLANA_HARD_MUTATION_ACTION_TOKENS.has(token))) {
    return true;
  }

  const hasTransferVerb = tokens.some((token) =>
    SOLANA_TRANSFER_ACTION_TOKENS.has(token),
  );
  if (hasTransferVerb) {
    if (!(hasReadIntent && hasReadQualifier)) return true;
  }

  if (hasReadIntent) {
    return false;
  }

  // Unknown plugin actions are treated as writes. This deliberately favors
  // transaction safety over more aggressive pruning of an uncertain result.
  return true;
}
/**
 * Build a ToolSet from the full action catalog.
 *
 * Every action from every installed first-party Solana Agent Kit v2 plugin
 * is converted into an AI SDK tool with no capability filtering.
 */
export async function buildSolanaAgentKitToolSet(
  actions: readonly Action[],
): Promise<ToolSet> {
  const plugins = await loadAllPlugins();
  const tools: ToolSet = {};
  for (const action of actions) {
    tools[action.name] = markToolEffect(tool({
      description: actionDescription(action),
      inputSchema: action.schema as never,
      contextSchema: agentToolContextSchema,
      execute: async (input, { context }) => {
        const { agentDbId } = requireAgentToolContext(context);
        try {
          const { kit, network, wallet } = await getAgentKit(
            agentDbId,
            plugins,
          );
          const result = await executeAction(
            action,
            kit,
            input as Record<string, unknown>,
          );
          return {
            ...result,
            toolkit: "solana-agent-kit-v2",
            action: action.name,
            network,
            wallet,
          };
        } catch (error) {
          return {
            status: "error",
            code: "SOLANA_AGENT_KIT_ERROR",
            message:
              Error.isError(error) ? redactSensitiveText(error.message) : "Solana tool failed",
            toolkit: "solana-agent-kit-v2",
            action: action.name,
          };
        }
      },
    }), { stateChanging: solanaActionStateChanging(action) });
  }
  return tools;
}
/** Every action exported by every installed first-party v2 plugin. */
export function getSolanaAgentKitTools(): Promise<ToolSet> {
  if (!toolsPromise) {
    toolsPromise = (async () => {
      const { loadAllActions } = await import("./catalog");
      const actions = await loadAllActions();
      return buildSolanaAgentKitToolSet(actions);
    })().catch((error) => {
      toolsPromise = null;
      console.warn(
        "[agent-chat] Failed to build Solana tool catalog; continuing without tools:",
        error instanceof Error ? redactSensitiveText(error.message) : redactSensitiveText(String(error)),
      );
      return {} as ToolSet;
    });
  }
  return toolsPromise;
}
