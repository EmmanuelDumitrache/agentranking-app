import "server-only";

import { PublicKey, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { prisma } from "@/lib/db";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import { detectLeaderTradeFromTx } from "@/lib/agent-trading/copy-trade/detect";
import {
  executeCopyTradeMirror,
  type CopyTradeConfigForMirror,
} from "@/lib/agent-trading/copy-trade/execute-mirror";

type ActiveConfigRow = CopyTradeConfigForMirror & {
  targetWallet: string;
  status: string;
  venue: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCopyTradePollMs(): number {
  const raw = Number.parseInt(process.env.COPY_TRADE_POLL_MS ?? "8000", 10);
  return Number.isFinite(raw) && raw >= 2000 ? raw : 8000;
}

function getCopyTradeSigLimit(): number {
  const raw = Number.parseInt(process.env.COPY_TRADE_SIG_LIMIT ?? "12", 10);
  return Number.isFinite(raw) && raw >= 3 && raw <= 40 ? raw : 12;
}

/**
 * Poll-based copy-trade engine.
 * Watches leader wallets via getSignaturesForAddress, detects buys/sells,
 * and mirrors onto agent custodial wallets through Jupiter.
 */
export class AgentCopyTradeEngine {
  private running = false;
  private loopPromise: Promise<void> | null = null;
  /** Per leader: newest signature we have already inspected (seeded on first see). */
  private readonly leaderTip = new Map<string, string>();
  /** Global processed leader signatures (bounded). */
  private readonly processedSigs = new Set<string>();
  private readonly processedOrder: string[] = [];
  private readonly maxProcessed = 5_000;
  private inflight = 0;
  private readonly maxInflight = 3;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.loop();
    console.info("[copy-trade] engine started", {
      pollMs: getCopyTradePollMs(),
      sigLimit: getCopyTradeSigLimit(),
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.loopPromise) {
      await this.loopPromise.catch(() => undefined);
      this.loopPromise = null;
    }
    console.info("[copy-trade] engine stopped");
  }

  private rememberProcessed(sig: string): void {
    if (this.processedSigs.has(sig)) return;
    this.processedSigs.add(sig);
    this.processedOrder.push(sig);
    while (this.processedOrder.length > this.maxProcessed) {
      const oldest = this.processedOrder.shift();
      if (oldest) this.processedSigs.delete(oldest);
    }
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const started = Date.now();
      try {
        await this.tick();
      } catch (error) {
        console.error("[copy-trade] tick failed", error);
      }
      const elapsed = Date.now() - started;
      const wait = Math.max(500, getCopyTradePollMs() - elapsed);
      await sleep(wait);
    }
  }

  private async loadActiveConfigs(): Promise<ActiveConfigRow[]> {
    const rows = await prisma.agentCopyTradeConfig.findMany({
      where: { status: "active", venue: "spot" },
      select: {
        id: true,
        agentDbId: true,
        targetWallet: true,
        status: true,
        venue: true,
        buyMode: true,
        buyPercent: true,
        buySolAmount: true,
        sellPercent: true,
        maxBuySol: true,
        portfolioAllocationPct: true,
        lastMirroredSig: true,
      },
    });
    return rows;
  }

  private async tick(): Promise<void> {
    const configs = await this.loadActiveConfigs();
    if (configs.length === 0) return;

    const byTarget = new Map<string, ActiveConfigRow[]>();
    for (const config of configs) {
      const list = byTarget.get(config.targetWallet) ?? [];
      list.push(config);
      byTarget.set(config.targetWallet, list);
    }

    // Drop tips for leaders that no longer have followers.
    for (const target of this.leaderTip.keys()) {
      if (!byTarget.has(target)) this.leaderTip.delete(target);
    }

    for (const [target, followers] of byTarget) {
      if (!this.running) break;
      try {
        await this.pollTarget(target, followers);
      } catch (error) {
        console.error("[copy-trade] poll target failed", { target, error });
      }
    }
  }

  private async pollTarget(
    target: string,
    followers: ActiveConfigRow[],
  ): Promise<void> {
    const connection = getAgentLaunchConnection();
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(target);
    } catch {
      console.warn("[copy-trade] invalid target wallet", { target });
      return;
    }

    const sigLimit = getCopyTradeSigLimit();
    const signatures = await connection.getSignaturesForAddress(pubkey, {
      limit: sigLimit,
    });
    if (signatures.length === 0) return;

    const newest = signatures[0]?.signature;
    if (!newest) return;

    // First time we see this leader: seed tip without mirroring history.
    if (!this.leaderTip.has(target)) {
      this.leaderTip.set(target, newest);
      console.info("[copy-trade] seeded leader tip", {
        target,
        tip: newest.slice(0, 8),
        followers: followers.length,
      });
      return;
    }

    const knownTip = this.leaderTip.get(target);
    // Process oldest-first among new signatures.
    const fresh: string[] = [];
    for (const row of signatures) {
      if (row.signature === knownTip) break;
      if (row.err) continue;
      fresh.push(row.signature);
    }
    fresh.reverse();

    for (const signature of fresh) {
      if (!this.running) break;
      if (this.processedSigs.has(signature)) continue;
      await this.processLeaderSignature(target, signature, followers);
      this.rememberProcessed(signature);
      this.leaderTip.set(target, signature);
    }

    // Advance tip even if nothing fresh (RPC returned only known).
    if (fresh.length === 0 && newest !== knownTip) {
      // Tip moved but we didn't walk it (unlikely with limit) — still advance.
      this.leaderTip.set(target, newest);
    }
  }

  private async processLeaderSignature(
    target: string,
    signature: string,
    followers: ActiveConfigRow[],
  ): Promise<void> {
    while (this.inflight >= this.maxInflight) {
      await sleep(200);
      if (!this.running) return;
    }
    this.inflight += 1;
    try {
      const connection = getAgentLaunchConnection();
      const tx = (await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      })) as ParsedTransactionWithMeta | null;

      if (!tx) {
        console.warn("[copy-trade] tx not found yet", {
          target,
          signature: signature.slice(0, 8),
        });
        return;
      }

      const trade = detectLeaderTradeFromTx(tx, target);
      if (!trade) return;

      console.info("[copy-trade] leader trade", {
        target: `${target.slice(0, 4)}…`,
        signature: signature.slice(0, 8),
        type: trade.type,
        token: `${trade.tokenMint.slice(0, 6)}…`,
        sol: trade.solAmount.toFixed(4),
        followers: followers.length,
      });

      for (const config of followers) {
        if (!this.running) break;
        try {
          const result = await executeCopyTradeMirror({
            config,
            trade,
            leaderSignature: signature,
          });
          if (result.ok && result.skipped) {
            console.info("[copy-trade] skip", {
              configId: config.id,
              reason: result.reason,
            });
            continue;
          }
          if (!result.ok) {
            console.warn("[copy-trade] mirror failed", {
              configId: config.id,
              agentDbId: config.agentDbId,
              code: result.code,
              message: result.message,
            });
            continue;
          }
          console.info("[copy-trade] mirrored", {
            configId: config.id,
            agentDbId: config.agentDbId,
            side: result.side,
            signature: result.signature.slice(0, 8),
            tradeId: result.tradeId,
          });
        } catch (error) {
          console.error("[copy-trade] mirror threw", {
            configId: config.id,
            error,
          });
        }
      }
    } finally {
      this.inflight = Math.max(0, this.inflight - 1);
    }
  }
}

let singleton: AgentCopyTradeEngine | null = null;

export function getAgentCopyTradeEngine(): AgentCopyTradeEngine {
  if (!singleton) singleton = new AgentCopyTradeEngine();
  return singleton;
}
