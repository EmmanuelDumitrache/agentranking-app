import "server-only";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  decodeEventLog,
  formatEther,
  formatUnits,
  getAddress,
  isAddress,
  parseAbiItem,
  type Address,
} from "viem";
import { prisma } from "@/lib/db";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import {
  releaseValkeyLease,
  renewValkeyLease,
  subscribeValkeyChannel,
  tryAcquireValkeyLease,
  valkeyPublish,
} from "@/lib/valkey";
import { getAgentLaunchNetwork } from "@/lib/agent-launch/solana";
import { AGENTRANKING_LISTING_SOURCE } from "@/lib/dashboard/native-agent";
import { AGENTRANKING_NATIVE_CHAIN_ID } from "@/lib/chain-constants";
import { getPumpFunBondingData } from "@/lib/public-site/pumpfun-bonding";
import { publicTokenDetailHref } from "@/lib/public-site/routes";
import { runPeriodicTask } from "@/lib/timing/periodic-task";
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import {
  buildAgentLaunchFeedEvent,
  buildAgentVerifiedFeedEvent,
  buildBondingMilestoneFeedEvent,
  buildFeeDistributionFeedEvent,
  buildHolderMilestoneFeedEvent,
  buildTokenLaunchFeedEvent,
  buildTokenVerifiedFeedEvent,
} from "@/lib/public-site/ar-live-feed-builders.server";
import { formatTradeFeedTitle, formatUsdCompact } from "@/lib/public-site/ar-live-feed-format";
import { loadArLiveFeedDigestEvents } from "@/lib/public-site/ar-live-feed-digests.server";
import {
  fetchRecentArMintBuys,
  getSolPriceUsd,
} from "@/lib/public-site/ar-live-feed-helius-trades.server";
import { getSolanaSplHolderCount } from "@/lib/public-site/solana-spl-holder-count.server";
import {
  AR_LIVE_FEED_BONDING_THRESHOLDS,
  AR_LIVE_FEED_HOLDER_THRESHOLDS,
  AR_LIVE_FEED_LARGE_BUY_ETH,
  AR_LIVE_FEED_LARGE_BUY_USD,
  AR_LIVE_FEED_MIN_BUY_ETH,
  AR_LIVE_FEED_MIN_BUY_USD,
  formatArLiveFeedAmount,
  newlyCrossedThresholds,
  type ArLiveFeedEvent,
  type ArLiveFeedKind,
} from "@/lib/public-site/ar-live-feed-types";
const BUFFER_LIMIT = 20;
const LIVE_FEED_CHANNEL = "agentranking:live-feed:events:v1";
const LIVE_FEED_LEADER_KEY = "agentranking:live-feed:leader:v1";
const LIVE_FEED_LEASE_MS = 15_000;
const LIVE_FEED_COORDINATION_MS = 5_000;
const SNAPSHOT_LIMIT = 5;
const DEDUPE_LIMIT = 400;
const DB_POLL_MS = 25_000;
const DATABASE_SEED_REUSE_MS = 5_000;
const ROBINHOOD_POLL_MS = 6_000;
const ROBINHOOD_BLOCK_LOOKBACK = BigInt(12);
const PUMPPORTAL_MINT_REFRESH_MS = 60_000;
const PUMPPORTAL_RECONNECT_BASE_MS = 2_000;
const PUMPPORTAL_RECONNECT_MAX_MS = 30_000;
const PUMPPORTAL_MAX_MESSAGE_CHARS = 256 * 1024;
const PUMPPORTAL_MAX_TRADES_PER_MESSAGE = 100;
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}
const MILESTONE_POLL_MS = 75_000;
const DIGEST_POLL_MS = 10 * 60_000;
const HELIUS_TRADE_POLL_MS = 20_000;
const MILESTONE_MINT_BATCH = 12;
const HELIUS_TRADE_MINT_BATCH = 6;
const UNISWAP_V3_SWAP_EVENT = parseAbiItem(
  "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
);
const UNISWAP_V3_TOKEN0_FUNCTION = parseAbiItem("function token0() view returns (address)");
const UNISWAP_V3_TOKEN1_FUNCTION = parseAbiItem("function token1() view returns (address)");
type ArLiveFeedSubscriber = (event: ArLiveFeedEvent) => void;
type PumpPortalMintInfo = {
  symbol: string | null;
  name: string | null;
  href: string;
};
type PumpPortalTrade = {
  txType?: unknown;
  transactionType?: unknown;
  side?: unknown;
  mint?: unknown;
  symbol?: unknown;
  name?: unknown;
  solAmount?: unknown;
  tokenAmount?: unknown;
  signature?: unknown;
  txSignature?: unknown;
  transaction?: unknown;
  timestamp?: unknown;
};
type RobinhoodPoolWatch = {
  poolAddress: Address;
  tokenAddress: Address;
  token0: Address;
  token1: Address;
  decimals: number;
  tokenSymbol: string | null;
  tokenName: string | null;
  href: string;
};
type RobinhoodPoolTokenCache = {
  token0: Address;
  token1: Address;
};
type UniswapSwapArgs = {
  amount0: bigint;
  amount1: bigint;
};
class ArLiveFeedHub {
  private readonly subscribers = new Set<ArLiveFeedSubscriber>();
  private readonly events: ArLiveFeedEvent[] = [];
  private readonly dedupe = new Set<string>();
  private readonly dedupeOrder: string[] = [];
  private readonly pumpMintInfo = new Map<string, PumpPortalMintInfo>();
  private readonly subscribedPumpMints = new Set<string>();
  private readonly robinhoodPoolTokenCache = new Map<string, RobinhoodPoolTokenCache>();
  private readonly robinhoodBlockTimestampCache = new Map<string, string>();
  private readonly bondingWatermark = new Map<string, number>();
  private readonly holderWatermark = new Map<string, number>();
  private readonly heliusBuySeen = new Set<string>();
  private heliusBuySeenOrder: string[] = [];
  private heliusTradeCursor = 0;
  private milestoneMintCursor = 0;
  private digestRotation = 0;
  private solPriceUsd: number | null = null;
  private sourceAbort: AbortController | null = null;
  private sourceLoops: Promise<void>[] = [];
  private sourceStopPromise: Promise<void> | null = null;
  private sourceStartPromise: Promise<void> | null = null;
  private sourceGeneration = 0;
  private pumpReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pumpWs: WebSocket | null = null;
  private pumpConnectionGeneration = 0;
  private pumpReconnectAttempts = 0;
  private pumpMintRefreshing = false;
  private startPromise: Promise<void> | null = null;
  private distributedAbort: AbortController | null = null;
  private distributedLoop: Promise<void> | null = null;
  private distributedUnsubscribe: (() => Promise<void>) | null = null;
  private readonly leaderToken = randomUUID();
  private leader = false;
  private running = false;
  private databaseSeedPromise: Promise<void> | null = null;
  private databaseSeededAt = 0;
  private pollingDb = false;
  private pollingRobinhood = false;
  private pollingMilestones = false;
  private pollingDigests = false;
  private pollingHeliusTrades = false;
  private heliusBuySeeded = false;
  get subscriberCount(): number {
    return this.subscribers.size;
  }
  getLatest(limit = SNAPSHOT_LIMIT): ArLiveFeedEvent[] {
    return this.events.slice(0, limit);
  }
  /** Push an event from write paths (fee claim, verify, launch confirm). */
  publish(event: ArLiveFeedEvent): void {
    const added = this.addEvent(event, this.subscribers.size > 0);
    if (added) void this.broadcastEvent(event);
  }
  async subscribe(subscriber: ArLiveFeedSubscriber): Promise<() => void> {
    this.subscribers.add(subscriber);
    try {
      await this.startSourcesIfNeeded();
    } catch (error) {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) this.stopRuntime();
      throw error;
    }
    return () => {
      this.subscribers.delete(subscriber);
      if (this.subscribers.size === 0) {
        this.stopRuntime();
      }
    };
  }
  private async startSourcesIfNeeded(): Promise<void> {
    if (this.distributedAbort) return;
    if (this.startPromise !== null) {
      await this.startPromise;
      return;
    }
    this.startPromise = this.startDistributedTransport();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }
  private async startDistributedTransport(): Promise<void> {
    if (this.subscribers.size === 0 || this.distributedAbort) return;
    const unsubscribe = await subscribeValkeyChannel(LIVE_FEED_CHANNEL, (message) => {
      const event = parseDistributedEvent(message);
      if (event) this.addEvent(event, this.subscribers.size > 0);
    });
    if (this.subscribers.size === 0) {
      await unsubscribe();
      return;
    }
    this.distributedUnsubscribe = unsubscribe;
    await this.seedFromDatabase();
    if (this.subscribers.size === 0) {
      this.stopRuntime();
      return;
    }
    const controller = new AbortController();
    this.distributedAbort = controller;
    const loop = this.runDistributedCoordination(controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) {
          console.error(
            "[ar-live-feed] coordination loop stopped:",
            Error.isError(error) ? error.message : String(error),
          );
        }
      })
      .finally(() => {
        if (this.distributedLoop === loop) this.distributedLoop = null;
      });
    this.distributedLoop = loop;
  }
  private async runDistributedCoordination(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && this.subscribers.size > 0) {
      if (this.leader) {
        const renewed = await renewValkeyLease({
          key: LIVE_FEED_LEADER_KEY,
          token: this.leaderToken,
          ttlMs: LIVE_FEED_LEASE_MS,
        });
        if (!renewed) this.loseLeadership();
      } else {
        const acquired = await tryAcquireValkeyLease({
          key: LIVE_FEED_LEADER_KEY,
          token: this.leaderToken,
          ttlMs: LIVE_FEED_LEASE_MS,
        });
        if (acquired) {
          this.leader = true;
          await this.startSources();
        }
      }
      if (signal.aborted || this.subscribers.size === 0) break;
      const jitterMs = Math.floor(Math.random() * 1_000);
      try {
        await delay(LIVE_FEED_COORDINATION_MS + jitterMs, undefined, {
          signal,
          ref: false,
        });
      } catch (error) {
        if (signal.aborted) break;
        throw error;
      }
    }
  }
  private loseLeadership(): void {
    this.leader = false;
    this.stopSources();
  }
  private stopRuntime(): void {
    this.stopSources();
    const controller = this.distributedAbort;
    this.distributedAbort = null;
    controller?.abort();
    const unsubscribe = this.distributedUnsubscribe;
    this.distributedUnsubscribe = null;
    const hadLeadership = this.leader;
    this.leader = false;
    if (hadLeadership || unsubscribe) {
      void (async () => {
        if (hadLeadership) {
          await releaseValkeyLease({
            key: LIVE_FEED_LEADER_KEY,
            token: this.leaderToken,
          });
        }
        await unsubscribe?.();
      })();
    }
  }
  private async startSources(): Promise<void> {
    for (;;) {
      const existingStart = this.sourceStartPromise;
      if (existingStart) {
        await existingStart;
      } else {
        const generation = this.sourceGeneration;
        const startPromise = this.startSourcesOnce(generation);
        this.sourceStartPromise = startPromise;
        try {
          await startPromise;
        } finally {
          if (this.sourceStartPromise === startPromise) this.sourceStartPromise = null;
        }
      }
      if (
        this.running ||
        this.subscribers.size === 0 ||
        !this.leader
      ) {
        return;
      }
      // A stop may invalidate an in-flight start while a new subscriber or
      // leadership lease arrives. Retry once the invalidated start settles.
    }
  }
  private async startSourcesOnce(generation: number): Promise<void> {
    if (this.sourceStopPromise) await this.sourceStopPromise;
    if (
      generation !== this.sourceGeneration ||
      this.running ||
      this.subscribers.size === 0
    ) {
      return;
    }
    await this.seedFromDatabase();
    if (
      generation !== this.sourceGeneration ||
      this.running ||
      this.subscribers.size === 0
    ) {
      return;
    }
    if (!this.leader) return;
    const renewed = await renewValkeyLease({
      key: LIVE_FEED_LEADER_KEY,
      token: this.leaderToken,
      ttlMs: LIVE_FEED_LEASE_MS,
    });
    if (!renewed) {
      this.leader = false;
      return;
    }
    if (generation !== this.sourceGeneration || !this.leader) return;
    this.running = true;
    const controller = new AbortController();
    this.sourceAbort = controller;
    const startLoop = (
      name: string,
      intervalMs: number,
      runImmediately: boolean,
      task: () => Promise<void>,
    ) => {
      const loop = runPeriodicTask({
        signal: controller.signal,
        intervalMs,
        runImmediately,
        task: async () => {
          if (!this.running || this.subscribers.size === 0) return;
          await task();
        },
        onError: (error) => {
          console.error(
            `[ar-live-feed] ${name} loop error:`,
            Error.isError(error) ? error.message : String(error),
          );
        },
      });
      this.sourceLoops.push(loop);
    };
    startLoop("database", DB_POLL_MS, false, () => this.pollDatabase());
    startLoop("robinhood", ROBINHOOD_POLL_MS, true, () => this.pollRobinhoodSwaps());
    startLoop("pump-mints", PUMPPORTAL_MINT_REFRESH_MS, false, () => this.refreshPumpPortalMints());
    startLoop("milestones", MILESTONE_POLL_MS, true, () => this.pollMilestones());
    startLoop("digests", DIGEST_POLL_MS, true, () => this.pollDigests());
    startLoop("helius", HELIUS_TRADE_POLL_MS, true, () => this.pollHeliusBuys());
    this.startPumpPortal();
  }
  private stopSources(): void {
    this.sourceGeneration += 1;
    this.running = false;
    const sourceAbort = this.sourceAbort;
    this.sourceAbort = null;
    sourceAbort?.abort("live-feed-stopped");
    const sourceLoops = this.sourceLoops;
    this.sourceLoops = [];
    if (sourceLoops.length > 0) {
      const stopPromise = Promise.allSettled(sourceLoops).then(() => undefined);
      this.sourceStopPromise = stopPromise;
      void stopPromise.finally(() => {
        if (this.sourceStopPromise === stopPromise) this.sourceStopPromise = null;
      });
    }
    if (this.pumpReconnectTimer) clearTimeout(this.pumpReconnectTimer);
    this.pumpReconnectTimer = null;
    this.subscribedPumpMints.clear();
    this.pumpConnectionGeneration += 1;
    this.pumpReconnectAttempts = 0;
    this.pumpMintRefreshing = false;
    const ws = this.pumpWs;
    this.pumpWs = null;
    if (ws && ws.readyState !== WebSocket.CLOSING && ws.readyState !== WebSocket.CLOSED) {
      try {
        ws.close();
      } catch {
        // A CONNECTING socket can reject close in some runtimes; generation guards ignore it.
      }
    }
  }
  private async broadcastEvent(event: ArLiveFeedEvent): Promise<void> {
    await valkeyPublish(LIVE_FEED_CHANNEL, JSON.stringify(event));
  }
  private emitSourceEvent(event: ArLiveFeedEvent): void {
    if (!this.running) return;
    if (!this.leader) return;
    const added = this.addEvent(event, true);
    if (added) void this.broadcastEvent(event);
  }
  private emitSourceEvents(events: readonly ArLiveFeedEvent[]): void {
    const ordered = [...events].sort(compareEventsAsc);
    for (const event of ordered) this.emitSourceEvent(event);
  }
  private async seedFromDatabase(): Promise<void> {
    const activeSeed = this.databaseSeedPromise;
    if (activeSeed) {
      await activeSeed;
      return;
    }
    if (Date.now() - this.databaseSeededAt < DATABASE_SEED_REUSE_MS) return;

    const seedPromise = (async () => {
      const events = await loadRecentDatabaseEvents();
      this.addEvents(events, false);
      this.databaseSeededAt = Date.now();
    })();
    this.databaseSeedPromise = seedPromise;
    try {
      await seedPromise;
    } finally {
      if (this.databaseSeedPromise === seedPromise) {
        this.databaseSeedPromise = null;
      }
    }
  }
  private async pollDatabase(): Promise<void> {
    if (this.pollingDb || this.subscribers.size === 0) return;
    this.pollingDb = true;
    try {
      const events = await loadRecentDatabaseEvents();
      this.emitSourceEvents(events);
    } finally {
      this.pollingDb = false;
    }
  }
  private replacePumpMintInfo(roster: Map<string, PumpPortalMintInfo>): void {
    for (const mint of this.pumpMintInfo.keys()) {
      if (roster.has(mint)) continue;
      this.pumpMintInfo.delete(mint);
      this.bondingWatermark.delete(mint);
      this.holderWatermark.delete(mint);
    }
    for (const [mint, info] of roster) {
      this.pumpMintInfo.set(mint, info);
    }
  }
  private async pollMilestones(): Promise<void> {
    if (this.pollingMilestones || this.subscribers.size === 0) return;
    this.pollingMilestones = true;
    try {
      const roster = await loadPumpPortalMintInfo();
      this.replacePumpMintInfo(roster);
      const mints = [...roster.keys()];
      if (mints.length === 0) return;
      const start = this.milestoneMintCursor % mints.length;
      const batch: string[] = [];
      for (let i = 0; i < Math.min(MILESTONE_MINT_BATCH, mints.length); i += 1) {
        batch.push(mints[(start + i) % mints.length]!);
      }
      this.milestoneMintCursor = (start + batch.length) % mints.length;
      for (const mint of batch) {
        const info = roster.get(mint);
        await this.evaluateBondingMilestones(mint, info);
        await this.evaluateHolderMilestones(mint, info);
      }
    } finally {
      this.pollingMilestones = false;
    }
  }
  private async evaluateBondingMilestones(
    mint: string,
    info: PumpPortalMintInfo | undefined,
  ): Promise<void> {
    const bonding = await getPumpFunBondingData(mint).catch(() => null);
    if (!bonding) return;
    const progress = bonding.graduated ? 100 : bonding.bondingProgressPct ?? 0;
    const previous = this.bondingWatermark.has(mint)
      ? (this.bondingWatermark.get(mint) ?? 0)
      : null;
    this.bondingWatermark.set(mint, progress);
    const crossed = newlyCrossedThresholds(previous, progress, AR_LIVE_FEED_BONDING_THRESHOLDS);
    for (const threshold of crossed) {
      this.emitSourceEvent(
        buildBondingMilestoneFeedEvent({
          mint,
          threshold,
          tokenSymbol: info?.symbol ?? bonding.symbol,
          tokenName: info?.name ?? bonding.name,
          href: info?.href,
        }),
      );
    }
  }
  private async evaluateHolderMilestones(
    mint: string,
    info: PumpPortalMintInfo | undefined,
  ): Promise<void> {
    const holders = await getSolanaSplHolderCount(mint);
    if (holders == null) return;
    const previous = this.holderWatermark.has(mint)
      ? (this.holderWatermark.get(mint) ?? 0)
      : null;
    this.holderWatermark.set(mint, holders);
    const crossed = newlyCrossedThresholds(previous, holders, AR_LIVE_FEED_HOLDER_THRESHOLDS);
    for (const threshold of crossed) {
      this.emitSourceEvent(
        buildHolderMilestoneFeedEvent({
          mint,
          threshold,
          tokenSymbol: info?.symbol ?? null,
          tokenName: info?.name ?? null,
          href: info?.href,
        }),
      );
    }
  }
  private async pollDigests(): Promise<void> {
    if (this.pollingDigests || this.subscribers.size === 0) return;
    this.pollingDigests = true;
    try {
      const events = await loadArLiveFeedDigestEvents(this.digestRotation);
      this.digestRotation += 1;
      this.emitSourceEvents(events);
    } catch {
      // Digests are optional enrichment.
    } finally {
      this.pollingDigests = false;
    }
  }
  private async pollHeliusBuys(): Promise<void> {
    if (this.pollingHeliusTrades || this.subscribers.size === 0) return;
    this.pollingHeliusTrades = true;
    try {
      this.solPriceUsd = await getSolPriceUsd();
      const roster = await loadPumpPortalMintInfo();
      this.replacePumpMintInfo(roster);
      if (this.solPriceUsd == null) return;
      const mints = [...roster.keys()];
      if (mints.length === 0) return;
      const cold = !this.heliusBuySeeded;
      const batchSize = cold
        ? Math.min(20, mints.length)
        : Math.min(HELIUS_TRADE_MINT_BATCH, mints.length);
      const start = this.heliusTradeCursor % mints.length;
      const batch: string[] = [];
      for (let i = 0; i < batchSize; i += 1) {
        batch.push(mints[(start + i) % mints.length]!);
      }
      if (!cold) {
        this.heliusTradeCursor = (start + batch.length) % mints.length;
      }
      const seedCandidates: ArLiveFeedEvent[] = [];
      for (const mint of batch) {
        const buys = await fetchRecentArMintBuys({
          mint,
          minUsd: AR_LIVE_FEED_MIN_BUY_USD,
          solPriceUsd: this.solPriceUsd,
        });
        const info = roster.get(mint);
        for (const buy of buys) {
          const id = `helius:${buy.signature}:buy`;
          if (this.heliusBuySeen.has(id) || this.dedupe.has(id)) {
            this.rememberHeliusBuyId(id);
            continue;
          }
          this.rememberHeliusBuyId(id);
          const usdLabel = formatUsdCompact(buy.usdAmount);
          const amountLabel = formatArLiveFeedAmount(buy.tokenAmount);
          const solAmountLabel = formatArLiveFeedAmount(buy.solAmount, "SOL");
          const symbol = info?.symbol ?? null;
          const event: ArLiveFeedEvent = {
            id,
            kind: "buy",
            chain: "solana",
            title: formatTradeFeedTitle({
              kind: "buy",
              symbol,
              amountLabel,
              quoteLabel: solAmountLabel,
              usdLabel,
              large: buy.usdAmount >= AR_LIVE_FEED_LARGE_BUY_USD,
            }),
            subtitle: solAmountLabel ?? undefined,
            symbol,
            name: info?.name ?? null,
            amountLabel: usdLabel ?? amountLabel,
            href: info?.href ?? publicTokenDetailHref(mint),
            occurredAt: buy.occurredAt,
          };
          if (cold) {
            seedCandidates.push(event);
            continue;
          }
          this.emitSourceEvent(event);
        }
      }
      if (cold) {
        // Immediate lift: surface the newest few $10+ buys, then only stream fresh ones.
        seedCandidates
          .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
          .slice(0, 5)
          .reverse()
          .forEach((event) => this.emitSourceEvent(event));
        this.heliusBuySeeded = true;
      }
    } finally {
      this.pollingHeliusTrades = false;
    }
  }
  private rememberHeliusBuyId(id: string): void {
    if (this.heliusBuySeen.has(id)) return;
    this.heliusBuySeen.add(id);
    this.heliusBuySeenOrder.push(id);
    while (this.heliusBuySeenOrder.length > DEDUPE_LIMIT) {
      const oldest = this.heliusBuySeenOrder.shift();
      if (oldest) this.heliusBuySeen.delete(oldest);
    }
  }
  private addEvents(events: readonly ArLiveFeedEvent[], notify: boolean): void {
    const ordered = [...events].sort(compareEventsAsc);
    for (const event of ordered) {
      this.addEvent(event, notify);
    }
  }
  private addEvent(event: ArLiveFeedEvent, notify: boolean): boolean {
    if (!this.rememberEventId(event.id)) return false;
    this.events.unshift(event);
    this.events.sort(compareEventsDesc);
    if (this.events.length > BUFFER_LIMIT) {
      this.events.length = BUFFER_LIMIT;
    }
    if (notify) {
      for (const subscriber of this.subscribers) {
        try {
          subscriber(event);
        } catch (error) {
          console.error(
            "[ar-live-feed] subscriber callback failed:",
            Error.isError(error) ? error.message : String(error),
          );
        }
      }
    }
    return true;
  }
  private rememberEventId(id: string): boolean {
    if (this.dedupe.has(id)) return false;
    this.dedupe.add(id);
    this.dedupeOrder.push(id);
    while (this.dedupeOrder.length > DEDUPE_LIMIT) {
      const oldest = this.dedupeOrder.shift();
      if (oldest) this.dedupe.delete(oldest);
    }
    return true;
  }
  private schedulePumpPortalReconnect(generation: number): void {
    if (!this.running || this.subscribers.size === 0 || generation !== this.pumpConnectionGeneration) return;
    if (this.pumpReconnectTimer) clearTimeout(this.pumpReconnectTimer);
    const exponent = Math.min(this.pumpReconnectAttempts, 5);
    const ceiling = Math.min(PUMPPORTAL_RECONNECT_MAX_MS, PUMPPORTAL_RECONNECT_BASE_MS * 2 ** exponent);
    const delayMs = Math.max(PUMPPORTAL_RECONNECT_BASE_MS, Math.floor(ceiling * (0.5 + Math.random() * 0.5)));
    this.pumpReconnectAttempts += 1;
    this.pumpReconnectTimer = setTimeout(() => {
      this.pumpReconnectTimer = null;
      if (generation === this.pumpConnectionGeneration) this.startPumpPortal();
    }, delayMs);
    unrefTimer(this.pumpReconnectTimer);
  }
  private startPumpPortal(): void {
    const apiKey = process.env.PUMPPORTAL_API_KEY?.trim();
    const WebSocketCtor = globalThis.WebSocket;
    if (!apiKey || !WebSocketCtor || this.subscribers.size === 0 || !this.running) return;
    if (this.pumpWs && (this.pumpWs.readyState === WebSocket.CONNECTING || this.pumpWs.readyState === WebSocket.OPEN)) return;
    const generation = ++this.pumpConnectionGeneration;
    const ws = new WebSocketCtor(
      `wss://pumpportal.fun/api/data?api-key=${encodeURIComponent(apiKey)}`,
    );
    this.pumpWs = ws;
    ws.addEventListener("open", () => {
      if (generation !== this.pumpConnectionGeneration || this.pumpWs !== ws) {
        ws.close();
        return;
      }
      this.pumpReconnectAttempts = 0;
      void this.refreshPumpPortalMints(ws, generation).catch((error) => {
        console.error(
          "[ar-live-feed] PumpPortal subscription refresh failed:",
          Error.isError(error) ? error.message : String(error),
        );
        if (generation === this.pumpConnectionGeneration && this.pumpWs === ws) {
          try {
            ws.close();
          } catch {
            this.pumpWs = null;
            this.schedulePumpPortalReconnect(generation);
          }
        }
      });
    });
    ws.addEventListener("message", (message) => {
      if (generation === this.pumpConnectionGeneration && this.pumpWs === ws) {
        this.handlePumpPortalMessage(message.data);
      }
    });
    ws.addEventListener("close", () => {
      if (generation !== this.pumpConnectionGeneration || this.pumpWs !== ws) return;
      this.pumpWs = null;
      this.schedulePumpPortalReconnect(generation);
    });
    ws.addEventListener("error", () => {
      if (generation !== this.pumpConnectionGeneration || this.pumpWs !== ws) return;
      try {
        ws.close();
      } catch {
        this.pumpWs = null;
        this.schedulePumpPortalReconnect(generation);
      }
    });
  }
  private async refreshPumpPortalMints(
    expectedWs: WebSocket | null = this.pumpWs,
    expectedGeneration = this.pumpConnectionGeneration,
  ): Promise<void> {
    if (this.pumpMintRefreshing || expectedWs?.readyState !== WebSocket.OPEN) return;
    if (this.pumpWs !== expectedWs || expectedGeneration !== this.pumpConnectionGeneration) return;
    this.pumpMintRefreshing = true;
    try {
      const mintInfo = await loadPumpPortalMintInfo();
      if (this.pumpWs !== expectedWs || expectedGeneration !== this.pumpConnectionGeneration || expectedWs.readyState !== WebSocket.OPEN) return;
      this.replacePumpMintInfo(mintInfo);
      const desiredMints = new Set(mintInfo.keys());
      const removedMints = [...this.subscribedPumpMints.difference(desiredMints)];
      if (removedMints.length > 0) {
        expectedWs.send(JSON.stringify({ method: "unsubscribeTokenTrade", keys: removedMints }));
        for (const mint of removedMints) this.subscribedPumpMints.delete(mint);
      }
      const newMints = [...desiredMints.difference(this.subscribedPumpMints)];
      if (newMints.length === 0) return;
      expectedWs.send(JSON.stringify({ method: "subscribeTokenTrade", keys: newMints }));
      for (const mint of newMints) this.subscribedPumpMints.add(mint);
    } finally {
      this.pumpMintRefreshing = false;
    }
  }
  private handlePumpPortalMessage(data: unknown): void {
    const parsed = parsePumpPortalPayload(data);
    if (!parsed) return;
    const trades = Array.isArray(parsed) ? parsed : [parsed];
    for (const trade of trades) {
      const event = this.pumpPortalTradeToEvent(trade);
      if (event) this.emitSourceEvent(event);
    }
  }
  private pumpPortalTradeToEvent(trade: PumpPortalTrade): ArLiveFeedEvent | null {
    const mint = stringValue(trade.mint);
    if (!mint) return null;
    const kind = normalizeTradeKind(
      stringValue(trade.txType) ?? stringValue(trade.transactionType) ?? stringValue(trade.side),
    );
    if (!kind) return null;
    const known = this.pumpMintInfo.get(mint);
    const symbol = cleanSymbol(stringValue(trade.symbol) ?? known?.symbol ?? null);
    const name = stringValue(trade.name) ?? known?.name ?? null;
    const tokenAmount = numberValue(trade.tokenAmount);
    const solAmount = numberValue(trade.solAmount);
    const usdAmount =
      kind === "buy" && solAmount != null && this.solPriceUsd != null
        ? solAmount * this.solPriceUsd
        : null;
    if (kind === "buy" && (usdAmount == null || usdAmount < AR_LIVE_FEED_MIN_BUY_USD)) {
      return null;
    }
    const amountLabel = formatArLiveFeedAmount(tokenAmount);
    const solAmountLabel = formatArLiveFeedAmount(solAmount, "SOL");
    const usdLabel = usdAmount != null ? formatUsdCompact(usdAmount) : null;
    const large = kind === "buy" && usdAmount != null && usdAmount >= AR_LIVE_FEED_LARGE_BUY_USD;
    const signature =
      stringValue(trade.signature) ?? stringValue(trade.txSignature) ?? stringValue(trade.transaction);
    return {
      id: signature
        ? `pump:${signature}:${kind}`
        : `pump:${mint}:${kind}:${tokenAmount ?? ""}:${solAmount ?? ""}`,
      kind,
      chain: "solana",
      title: formatTradeFeedTitle({
        kind,
        symbol,
        amountLabel,
        quoteLabel: solAmountLabel,
        usdLabel: kind === "buy" ? usdLabel : null,
        large,
      }),
      subtitle: large ? amountLabel ?? undefined : solAmountLabel ?? undefined,
      symbol,
      name,
      amountLabel: usdLabel ?? amountLabel,
      href: known?.href ?? publicTokenDetailHref(mint),
      occurredAt: dateFromUnknown(trade.timestamp).toISOString(),
    };
  }
  private async pollRobinhoodSwaps(): Promise<void> {
    if (this.pollingRobinhood || this.subscribers.size === 0) return;
    this.pollingRobinhood = true;
    try {
      const watches = await loadRobinhoodPoolWatches(this.robinhoodPoolTokenCache);
      if (watches.size === 0) return;
      const client = createRobinhoodPublicClient();
      const latest = await client.getBlockNumber();
      const fromBlock = latest > ROBINHOOD_BLOCK_LOOKBACK
        ? latest - ROBINHOOD_BLOCK_LOOKBACK
        : BigInt(0);
      const logs = await client.getLogs({
        address: [...watches.keys()] as Address[],
        event: UNISWAP_V3_SWAP_EVENT,
        fromBlock,
        toBlock: latest,
      });
      for (const log of logs) {
        const event = await decodeRobinhoodSwapLog(
          log,
          watches,
          this.robinhoodBlockTimestampCache,
        );
        if (event) this.emitSourceEvent(event);
      }
    } finally {
      this.pollingRobinhood = false;
    }
  }
}
async function loadRecentDatabaseEvents(): Promise<ArLiveFeedEvent[]> {
  const [solanaLaunches, robinhoodLaunches, nativeAgents, feeEvents, verifiedAgents, verifiedTokens] =
    await Promise.all([
      loadRecentSolanaLaunchEvents(),
      loadRecentRobinhoodLaunchEvents(),
      loadRecentNativeAgentEvents(),
      loadRecentFeeEvents(),
      loadRecentVerifiedAgentEvents(),
      loadRecentVerifiedTokenEvents(),
    ]);
  return [
    ...solanaLaunches,
    ...robinhoodLaunches,
    ...nativeAgents,
    ...feeEvents,
    ...verifiedAgents,
    ...verifiedTokens,
  ]
    .sort(compareEventsDesc)
    .slice(0, BUFFER_LIMIT);
}
async function loadRecentSolanaLaunchEvents(): Promise<ArLiveFeedEvent[]> {
  const network = getAgentLaunchNetwork();
  const launches = await prisma.agentLaunch.findMany({
    where: {
      network,
      launchStatus: "indexed",
      feeSharingStatus: "active",
      mint: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: {
      id: true,
      mint: true,
      tokenName: true,
      tokenSymbol: true,
      profileDisplayName: true,
      createdAt: true,
      linkedAgent: {
        select: {
          name: true,
        },
      },
    },
  });
  return launches
    .filter((launch): launch is typeof launch & { mint: string } => Boolean(launch.mint))
    .map((launch) =>
      buildTokenLaunchFeedEvent({
        launchId: launch.id,
        mint: launch.mint,
        tokenSymbol: launch.tokenSymbol,
        tokenName: launch.tokenName,
        profileDisplayName: launch.profileDisplayName,
        agentName: launch.linkedAgent?.name ?? null,
        createdAt: launch.createdAt,
        chain: "solana",
      }),
    );
}
async function loadRecentRobinhoodLaunchEvents(): Promise<ArLiveFeedEvent[]> {
  const launches = await prisma.robinhoodChainLaunch.findMany({
    orderBy: { blockTimestamp: "desc" },
    take: 8,
    select: {
      id: true,
      tokenAddress: true,
      tokenName: true,
      tokenSymbol: true,
      blockTimestamp: true,
    },
  });
  return launches.map((launch) =>
    buildTokenLaunchFeedEvent({
      launchId: launch.id,
      mint: launch.tokenAddress,
      tokenSymbol: launch.tokenSymbol,
      tokenName: launch.tokenName,
      createdAt: launch.blockTimestamp,
      chain: "robinhood",
    }),
  );
}
async function loadRecentNativeAgentEvents(): Promise<ArLiveFeedEvent[]> {
  const where = await extendAgentWhereIndexable({
    listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
    chainId: AGENTRANKING_NATIVE_CHAIN_ID,
  });
  const agents = await prisma.agent.findMany({
    where,
    orderBy: [{ listedAt: "desc" }, { id: "desc" }],
    take: 8,
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      listedAt: true,
      description: true,
    },
  });
  return agents.map((agent) =>
    buildAgentLaunchFeedEvent({
      agentDbId: agent.id,
      chainId: agent.chainId,
      agentId: agent.agentId,
      name: agent.name,
      description: agent.description,
      listedAt: agent.listedAt,
    }),
  );
}
async function loadRecentFeeEvents(): Promise<ArLiveFeedEvent[]> {
  const network = getAgentLaunchNetwork();
  const rows = await prisma.agentLaunchFeeDistribution.findMany({
    where: { network },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: {
      id: true,
      mint: true,
      creatorAmount: true,
      createdAt: true,
      launch: {
        select: {
          tokenSymbol: true,
          tokenName: true,
          profileDisplayName: true,
        },
      },
    },
  });
  return rows.map((row) =>
    buildFeeDistributionFeedEvent({
      distributionId: row.id,
      mint: row.mint,
      creatorAmountLamports: row.creatorAmount,
      tokenSymbol: row.launch.tokenSymbol,
      tokenName: row.launch.profileDisplayName ?? row.launch.tokenName,
      createdAt: row.createdAt,
    }),
  );
}
async function loadRecentVerifiedAgentEvents(): Promise<ArLiveFeedEvent[]> {
  const agents = await prisma.agent.findMany({
    where: {
      listingRegistrySource: AGENTRANKING_LISTING_SOURCE,
      chainId: AGENTRANKING_NATIVE_CHAIN_ID,
      OR: [
        { arVerificationStatus: "verified" },
        { publicVerificationStatus: "verified" },
      ],
    },
    orderBy: [{ arVerifiedAt: "desc" }, { id: "desc" }],
    take: 4,
    select: {
      id: true,
      agentId: true,
      chainId: true,
      name: true,
      arVerifiedAt: true,
    },
  });
  return agents.map((agent) =>
    buildAgentVerifiedFeedEvent({
      agentDbId: agent.id,
      chainId: agent.chainId,
      agentId: agent.agentId,
      name: agent.name,
      verifiedAt: agent.arVerifiedAt,
    }),
  );
}
async function loadRecentVerifiedTokenEvents(): Promise<ArLiveFeedEvent[]> {
  const network = getAgentLaunchNetwork();
  const launches = await prisma.agentLaunch.findMany({
    where: {
      network,
      arTokenVerificationStatus: "verified",
      mint: { not: null },
    },
    orderBy: [{ arTokenVerifiedAt: "desc" }, { createdAt: "desc" }],
    take: 4,
    select: {
      id: true,
      mint: true,
      tokenSymbol: true,
      tokenName: true,
      profileDisplayName: true,
      arTokenVerifiedAt: true,
    },
  });
  return launches
    .filter((launch): launch is typeof launch & { mint: string } => Boolean(launch.mint))
    .map((launch) =>
      buildTokenVerifiedFeedEvent({
        launchId: launch.id,
        mint: launch.mint,
        tokenSymbol: launch.tokenSymbol,
        tokenName: launch.profileDisplayName ?? launch.tokenName,
        verifiedAt: launch.arTokenVerifiedAt,
      }),
    );
}
async function loadPumpPortalMintInfo(): Promise<Map<string, PumpPortalMintInfo>> {
  const network = getAgentLaunchNetwork();
  const launches = await prisma.agentLaunch.findMany({
    where: {
      network,
      launchStatus: "indexed",
      feeSharingStatus: "active",
      mint: { not: null },
    },
    orderBy: { createdAt: "desc" },
    take: 250,
    select: {
      mint: true,
      tokenSymbol: true,
      tokenName: true,
      profileDisplayName: true,
    },
  });
  const mintInfo = new Map<string, PumpPortalMintInfo>();
  for (const launch of launches) {
    if (!launch.mint) continue;
    mintInfo.set(launch.mint, {
      symbol: cleanSymbol(launch.tokenSymbol),
      name: launch.profileDisplayName ?? launch.tokenName ?? null,
      href: publicTokenDetailHref(launch.mint),
    });
  }
  return mintInfo;
}
async function loadRobinhoodPoolWatches(
  cache: Map<string, RobinhoodPoolTokenCache>,
): Promise<Map<Address, RobinhoodPoolWatch>> {
  const launches = await prisma.robinhoodChainLaunch.findMany({
    where: { poolAddress: { not: null } },
    orderBy: { blockTimestamp: "desc" },
    take: 100,
    select: {
      tokenAddress: true,
      poolAddress: true,
      tokenName: true,
      tokenSymbol: true,
      decimals: true,
    },
  });
  const watches = new Map<Address, RobinhoodPoolWatch>();
  const client = createRobinhoodPublicClient();
  for (const launch of launches) {
    if (!launch.poolAddress || !isAddress(launch.poolAddress) || !isAddress(launch.tokenAddress)) {
      continue;
    }
    const poolAddress = getAddress(launch.poolAddress);
    const tokenAddress = getAddress(launch.tokenAddress);
    const cacheKey = poolAddress.toLowerCase();
    const poolTokens = cache.get(cacheKey) ?? await readPoolTokens(client, poolAddress);
    if (!poolTokens) continue;
    cache.delete(cacheKey);
    cache.set(cacheKey, poolTokens);
    while (cache.size > 256) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    watches.set(poolAddress, {
      poolAddress,
      tokenAddress,
      token0: poolTokens.token0,
      token1: poolTokens.token1,
      decimals: launch.decimals ?? 18,
      tokenSymbol: cleanSymbol(launch.tokenSymbol),
      tokenName: launch.tokenName,
      href: `/tokens/robinhood/${tokenAddress}`,
    });
  }
  return watches;
}
async function readPoolTokens(
  client: ReturnType<typeof createRobinhoodPublicClient>,
  poolAddress: Address,
): Promise<RobinhoodPoolTokenCache | null> {
  try {
    const [token0, token1] = await Promise.all([
      client.readContract({
        address: poolAddress,
        abi: [UNISWAP_V3_TOKEN0_FUNCTION],
        functionName: "token0",
      }),
      client.readContract({
        address: poolAddress,
        abi: [UNISWAP_V3_TOKEN1_FUNCTION],
        functionName: "token1",
      }),
    ]);
    if (!isAddress(token0) || !isAddress(token1)) return null;
    return { token0: getAddress(token0), token1: getAddress(token1) };
  } catch {
    return null;
  }
}
async function decodeRobinhoodSwapLog(
  log: {
    address: Address;
    data: `0x${string}`;
    topics: readonly [`0x${string}`, ...`0x${string}`[]];
    transactionHash?: `0x${string}` | null;
    logIndex?: number | bigint | null;
    blockNumber?: bigint | null;
  },
  watches: ReadonlyMap<Address, RobinhoodPoolWatch>,
  blockTimestampCache: Map<string, string>,
): Promise<ArLiveFeedEvent | null> {
  const watch = watches.get(getAddress(log.address));
  const txHash = log.transactionHash;
  if (!watch || !txHash) return null;
  let args: UniswapSwapArgs;
  try {
    const topics = [...log.topics] as [`0x${string}`, ...`0x${string}`[]];
    const decoded = decodeEventLog({
      abi: [UNISWAP_V3_SWAP_EVENT],
      eventName: "Swap",
      data: log.data,
      topics,
    });
    args = decoded.args;
  } catch {
    return null;
  }
  const tokenIndex = tokenIndexForWatch(watch);
  if (tokenIndex == null) return null;
  const tokenDelta = tokenIndex === 0 ? args.amount0 : args.amount1;
  const quoteDelta = tokenIndex === 0 ? args.amount1 : args.amount0;
  if (tokenDelta === BigInt(0)) return null;
  const kind: ArLiveFeedKind = tokenDelta < BigInt(0) ? "buy" : "sell";
  const tokenAmount = formatUnits(absBigInt(tokenDelta), watch.decimals);
  const amountLabel = formatArLiveFeedAmount(tokenAmount);
  const quoteEth = Number(formatEther(absBigInt(quoteDelta)));
  if (kind === "buy" && quoteEth < AR_LIVE_FEED_MIN_BUY_ETH) return null;
  const quoteLabel = formatArLiveFeedAmount(quoteEth, "ETH");
  const large = kind === "buy" && quoteEth >= AR_LIVE_FEED_LARGE_BUY_ETH;
  const occurredAt = await robinhoodLogTimestamp(log.blockNumber, blockTimestampCache);
  return {
    id: `rh-swap:${txHash}:${String(log.logIndex ?? 0)}`,
    kind,
    chain: "robinhood",
    title: formatTradeFeedTitle({
      kind,
      symbol: watch.tokenSymbol,
      amountLabel,
      quoteLabel,
      large,
    }),
    subtitle: large ? amountLabel ?? undefined : undefined,
    symbol: watch.tokenSymbol,
    name: watch.tokenName,
    amountLabel,
    href: watch.href,
    occurredAt,
  };
}
function tokenIndexForWatch(watch: RobinhoodPoolWatch): 0 | 1 | null {
  const token = watch.tokenAddress.toLowerCase();
  if (watch.token0.toLowerCase() === token) return 0;
  if (watch.token1.toLowerCase() === token) return 1;
  return null;
}
async function robinhoodLogTimestamp(
  blockNumber: bigint | null | undefined,
  cache: Map<string, string>,
): Promise<string> {
  if (blockNumber == null) return new Date().toISOString();
  const key = blockNumber.toString();
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }
  try {
    const client = createRobinhoodPublicClient();
    const block = await client.getBlock({ blockNumber });
    const iso = new Date(Number(block.timestamp) * 1_000).toISOString();
    cache.set(key, iso);
    while (cache.size > 2_048) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
    return iso;
  } catch {
    return new Date().toISOString();
  }
}
function parsePumpPortalPayload(data: unknown): PumpPortalTrade | PumpPortalTrade[] | null {
  if (typeof data !== "string" || data.length > PUMPPORTAL_MAX_MESSAGE_CHARS) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, PUMPPORTAL_MAX_TRADES_PER_MESSAGE).filter(isObjectRecord);
    }
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function normalizeTradeKind(raw: string | null): "buy" | "sell" | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (value.includes("buy")) return "buy";
  if (value.includes("sell")) return "sell";
  return null;
}
function dateFromUnknown(value: unknown): Date {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1_000);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}
function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function parseDistributedEvent(message: string): ArLiveFeedEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const event = value as Partial<ArLiveFeedEvent>;
  if (
    typeof event.id !== "string" ||
    !isLiveFeedKind(event.kind) ||
    (event.chain !== "solana" && event.chain !== "robinhood") ||
    typeof event.title !== "string" ||
    (event.subtitle !== undefined && typeof event.subtitle !== "string") ||
    (event.symbol !== null && typeof event.symbol !== "string") ||
    (event.name !== null && typeof event.name !== "string") ||
    (event.amountLabel !== null && typeof event.amountLabel !== "string") ||
    typeof event.href !== "string" ||
    typeof event.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(event.occurredAt))
  ) {
    return null;
  }
  return event as ArLiveFeedEvent;
}
function isLiveFeedKind(value: unknown): value is ArLiveFeedKind {
  return (
    value === "buy" ||
    value === "sell" ||
    value === "token_launch" ||
    value === "agent_launch" ||
    value === "fees" ||
    value === "verified" ||
    value === "milestone" ||
    value === "digest"
  );
}
function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function cleanSymbol(symbol: string | null | undefined): string | null {
  const trimmed = symbol?.trim().replace(/^\$/, "");
  return trimmed ? trimmed.toUpperCase() : null;
}
function absBigInt(value: bigint): bigint {
  return value < BigInt(0) ? -value : value;
}
function compareEventsDesc(a: ArLiveFeedEvent, b: ArLiveFeedEvent): number {
  return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
}
function compareEventsAsc(a: ArLiveFeedEvent, b: ArLiveFeedEvent): number {
  return new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
}
const globalForArLiveFeed = globalThis as typeof globalThis & {
  __arLiveFeedHub?: ArLiveFeedHub;
};
export const arLiveFeedHub = globalForArLiveFeed.__arLiveFeedHub ?? new ArLiveFeedHub();
globalForArLiveFeed.__arLiveFeedHub = arLiveFeedHub;
