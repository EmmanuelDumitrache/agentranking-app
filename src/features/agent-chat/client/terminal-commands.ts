export type TerminalLocalLine = {
  id: string;
  kind: "user" | "output" | "error";
  text: string;
  at: string;
};

export type TerminalCommandContext = {
  agentDbId: number;
  agentName: string;
  agentCardConfigured: boolean;
};

export type TerminalCommandResult =
  | {
      handled: true;
      clearLocal?: boolean;
      resetSession?: boolean;
      lines: Omit<TerminalLocalLine, "id" | "at">[];
    }
  | { handled: false };

const WALLET_TOOLS = [
  "get_wallet_status      — SOL / USDC / $AR balances for this agent",
  "list_recent_transfers  — recent custodial SOL sends",
  "send_sol               — send SOL",
] as const;

const AGENTCARD_TOOLS = [
  "agentcard_status           — payment method & spend limits",
  "agentcard_request_card     — issue single-use card",
  "agentcard_get_request      — purchase status (non-sensitive metadata)",
  "agentcard_cancel_request   — cancel pending card",
  "agentcard_wallet_balance   — operator AgentCard wallet",
] as const;

function buildHelpText(ctx: TerminalCommandContext): string {
  const lines = [
    "AgentRanking Terminal — commands",
    "",
    "Local (instant, no model):",
    "  /help              Show this list",
    "  /clear             Clear local terminal output",
    "  /new               Start a fresh agent session",
    "  /tools             List callable agent tools",
    "  /status            Wallet address & balances",
    "",
    "Agent prompts (any other text → model + [exec] activity log):",
    "  balance            → get_wallet_status",
    "  recent transfers   → list_recent_transfers",
    "  send 0.1 sol to …  → send_sol",
    "  what tools exist   → authoritative runtime inventory",
    "",
    "Wallet tools:",
    ...WALLET_TOOLS.map((line) => `  ${line}`),
  ];
  if (ctx.agentCardConfigured) {
    lines.push("", "AgentCard tools (Tier 1):", ...AGENTCARD_TOOLS.map((line) => `  ${line}`));
  }
  lines.push(
    "",
    "Trade UI: Copy Trade · Swap · Leverage (dashboard nav)",
    "",
    `Agent: ${ctx.agentName.trim() || "Agent"}`,
  );
  return lines.join("\n");
}

function buildToolsText(ctx: TerminalCommandContext): string {
  const lines = [
    "AgentRanking-native convenience tools:",
    "",
    "[wallet]",
    ...WALLET_TOOLS.map((line) => `  ${line}`),
    "",
    "[discovery]",
    "  Ask the agent to list/show its tools for an authoritative runtime inventory.",
  ];
  if (ctx.agentCardConfigured) {
    lines.push("", "[agentcard]", ...AGENTCARD_TOOLS.map((line) => `  ${line}`));
  }
  lines.push(
    "",
    "The model runtime also receives the complete installed Solana Agent Kit action catalog and all discovered MCP/provider tools.",
    "Ask ‘list all the tools you have’ for the authoritative full runtime inventory.",
    "Activity shows as [exec] lines with in:/out: payloads.",
  );
  return lines.join("\n");
}

function formatLamports(lamports: number): string {
  return (lamports / 1_000_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
}

function formatTokenRaw(raw: string | null, decimals: number): string {
  if (!raw) return "—";
  const n = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

async function fetchWalletStatus(agentDbId: number): Promise<string> {
  const res = await fetch(`/api/dashboard/agents/${agentDbId}/sync-balance`, {
    method: "POST",
  });
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    publicKey?: string;
    solBalanceLamports?: number;
    usdcBalanceRaw?: string | null;
    arBalanceRaw?: string | null;
    solscanUrl?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `Status failed (${res.status})`);
  }
  return [
    "[status] agent wallet",
    `  address: ${body.publicKey ?? "—"}`,
    `  SOL:     ${body.solBalanceLamports != null ? formatLamports(body.solBalanceLamports) : "—"}`,
    `  USDC:    ${formatTokenRaw(body.usdcBalanceRaw ?? null, 6)}`,
    `  AR:      ${formatTokenRaw(body.arBalanceRaw ?? null, 6)}`,
    body.solscanUrl ? `  solscan: ${body.solscanUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function isTerminalSlashCommand(input: string): boolean {
  return input.trim().startsWith("/");
}

export async function executeTerminalCommand(
  input: string,
  ctx: TerminalCommandContext,
): Promise<TerminalCommandResult> {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return { handled: false };

  const [commandToken, ...argParts] = trimmed.split(/\s+/);
  const command = commandToken.toLowerCase();
  const args = argParts.join(" ").trim();

  switch (command) {
    case "/help":
    case "/h":
    case "/?":
      return {
        handled: true,
        lines: [{ kind: "output", text: buildHelpText(ctx) }],
      };
    case "/tools":
      return {
        handled: true,
        lines: [{ kind: "output", text: buildToolsText(ctx) }],
      };
    case "/clear":
      return { handled: true, clearLocal: true, lines: [] };
    case "/new":
      return {
        handled: true,
        resetSession: true,
        lines: [{ kind: "output", text: "[session] started new conversation" }],
      };
    case "/status":
    case "/balance":
    case "/bal": {
      try {
        const text = await fetchWalletStatus(ctx.agentDbId);
        return { handled: true, lines: [{ kind: "output", text }] };
      } catch (error) {
        return {
          handled: true,
          lines: [
            {
              kind: "error",
              text: error instanceof Error ? error.message : "Could not load wallet status",
            },
          ],
        };
      }
    }
    default:
      return {
        handled: true,
        lines: [
          {
            kind: "error",
            text: `Unknown command: ${commandToken}${args ? ` ${args}` : ""}\nType /help for available commands.`,
          },
        ],
      };
  }
}

export function createTerminalLocalLine(
  line: Omit<TerminalLocalLine, "id" | "at"> & { at?: string },
): TerminalLocalLine {
  return {
    ...line,
    at: line.at ?? new Date().toISOString(),
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };
}
