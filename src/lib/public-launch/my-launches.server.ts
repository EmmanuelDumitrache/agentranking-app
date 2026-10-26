import "server-only";
import { formatEther } from "viem";
import type { Prisma } from "@/generated/prisma/client";
import { mapWithConcurrency } from "@/lib/async-pool";
import { prisma } from "@/lib/db";
import { publicTokenDetailHref } from "@/lib/public-site/routes";
import { getLaunchWalletSession } from "@/lib/launch-wallet-session/session";
import { walletsMatch } from "@/lib/launch-wallet-session/wallet-match";
import { getAgentWalletSolBalanceLamports } from "@/lib/metaplex-launch/umi-factory.server";
import { buildMetaplexFundingQuote } from "@/lib/public-launch/metaplex-funding-quote.server";
import type {
  PublicLaunchesResponse,
  PublicMetaplexLaunchRow,
} from "@/lib/public-launch/my-launches-types";

function solanaLaunchHref(launch: { mint: string | null }): string | null {
  if (launch.mint?.trim()) return publicTokenDetailHref(launch.mint.trim());
  return null;
}

function snapshotString(snapshot: unknown, key: string): string | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = (snapshot as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function mapMetaplexLaunch(
  launch: {
    id: string;
    status: string;
    tokenMint: string | null;
    assetAddress: string | null;
    genesisAddress: string | null;
    genesisTxSignatures: string[];
    imageUri: string | null;
    walletAddress: string;
    inputSnapshot: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    errorMessage: string | null;
  },
): Promise<PublicMetaplexLaunchRow> {
  let balanceLamports = 0;
  try {
    balanceLamports = await getAgentWalletSolBalanceLamports(launch.walletAddress);
  } catch {
    // A transient RPC failure must not prevent the wallet-owned launch list from rendering.
  }
  const quote = buildMetaplexFundingQuote({ attempt: launch, balanceLamports });
  const mint = launch.tokenMint?.trim() || null;
  const imageUrl = snapshotString(launch.inputSnapshot, "tokenImageUrl") ?? launch.imageUri;
  return {
    id: launch.id,
    name: snapshotString(launch.inputSnapshot, "tokenName"),
    symbol: snapshotString(launch.inputSnapshot, "tokenSymbol"),
    imageUrl,
    status: launch.status,
    mint,
    href: mint ? publicTokenDetailHref(mint) : null,
    continueHref: `/launch?chain=metaplex&attempt=${encodeURIComponent(launch.id)}`,
    custodialWallet: launch.walletAddress,
    balanceLamports: quote.balanceLamports,
    minLamports: quote.minLamports,
    shortfallLamports: quote.shortfallLamports,
    funded: quote.funded,
    fundingMessage: quote.fundingMessage,
    errorMessage: launch.errorMessage,
    createdAt: launch.createdAt.toISOString(),
    updatedAt: launch.updatedAt.toISOString(),
  };
}

export async function readPublicLaunchesSnapshot(): Promise<PublicLaunchesResponse> {
  const session = await getLaunchWalletSession();
  if (!session) {
    return { ok: false, error: "Wallet session required" };
  }
  const [solanaLaunches, robinhoodLaunches, metaplexRows] = await Promise.all([
    session.chain === "solana"
      ? prisma.agentLaunch.findMany({
          where: { creatorWallet: session.wallet },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            mint: true,
            tokenName: true,
            tokenSymbol: true,
            tokenImageUrl: true,
            launchStatus: true,
            feeSharingStatus: true,
            launchKind: true,
            createdAt: true,
            totalFeesDistributedLamports: true,
            creatorShareBps: true,
            arShareBps: true,
          },
        })
      : Promise.resolve([]),
    session.chain === "evm"
      ? prisma.robinhoodChainLaunch.findMany({
          where: { creatorWallet: { equals: session.wallet, mode: "insensitive" } },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            tokenAddress: true,
            tokenName: true,
            tokenSymbol: true,
            tokenImageUrl: true,
            txHash: true,
            creatorFeeBps: true,
            createdAt: true,
            poolAddress: true,
            positionId: true,
            feeSplitterAddress: true,
          },
        })
      : Promise.resolve([]),
    session.chain === "solana"
      ? prisma.metaplexLaunchAttempt.findMany({
          where: {
            status: { notIn: ["COMPLETE", "FAILED_FINAL"] },
            publicCreatorWallet: session.wallet,
          },
          orderBy: { updatedAt: "desc" },
          take: 40,
          select: {
            id: true,
            status: true,
            tokenMint: true,
            assetAddress: true,
            genesisAddress: true,
            genesisTxSignatures: true,
            imageUri: true,
            walletAddress: true,
            inputSnapshot: true,
            createdAt: true,
            updatedAt: true,
            errorMessage: true,
          },
        })
      : Promise.resolve([]),
  ]);
  const metaplex = await mapWithConcurrency(metaplexRows, 5, mapMetaplexLaunch);
  return {
    ok: true,
    wallet: session.wallet,
    chain: session.chain,
    solana: solanaLaunches.map((launch) => ({
      id: launch.id,
      chain: "solana" as const,
      name: launch.tokenName,
      symbol: launch.tokenSymbol,
      imageUrl: launch.tokenImageUrl,
      status: launch.launchStatus,
      feeSharingStatus: launch.feeSharingStatus,
      launchKind: launch.launchKind,
      mint: launch.mint,
      href: solanaLaunchHref(launch),
      createdAt: launch.createdAt.toISOString(),
      totalDistributedLamports: launch.totalFeesDistributedLamports.toString(),
      creatorShareBps: launch.creatorShareBps,
      arShareBps: launch.arShareBps,
    })),
    robinhood: robinhoodLaunches.map((launch) => ({
      id: launch.id,
      chain: "robinhood" as const,
      name: launch.tokenName,
      symbol: launch.tokenSymbol,
      imageUrl: launch.tokenImageUrl,
      tokenAddress: launch.tokenAddress,
      txHash: launch.txHash,
      href: `/tokens/robinhood/${launch.tokenAddress}`,
      createdAt: launch.createdAt.toISOString(),
      creatorFeeBps: launch.creatorFeeBps,
      poolAddress: launch.poolAddress,
      positionId: launch.positionId,
      feeSplitterAddress: launch.feeSplitterAddress,
    })),
    metaplex,
  };
}

export async function assertLaunchWalletOwnsSolanaLaunch(
  launchId: string,
  sessionWallet: string,
): Promise<
  | { ok: true; launch: Awaited<ReturnType<typeof prisma.agentLaunch.findUnique>> & object }
  | { ok: false; status: number; error: string }
> {
  const launch = await prisma.agentLaunch.findUnique({ where: { id: launchId } });
  if (!launch) {
    return { ok: false, status: 404, error: "Launch not found" };
  }
  if (!launch.creatorWallet || !walletsMatch("solana", launch.creatorWallet, sessionWallet)) {
    return { ok: false, status: 403, error: "Wallet does not own this launch" };
  }
  return { ok: true, launch };
}

export async function assertLaunchWalletOwnsRobinhoodLaunch(
  launchId: string,
  sessionWallet: string,
): Promise<
  | { ok: true; launch: NonNullable<Awaited<ReturnType<typeof prisma.robinhoodChainLaunch.findUnique>>> }
  | { ok: false; status: number; error: string }
> {
  const launch = await prisma.robinhoodChainLaunch.findUnique({ where: { id: launchId } });
  if (!launch) {
    return { ok: false, status: 404, error: "Launch not found" };
  }
  if (!walletsMatch("evm", launch.creatorWallet, sessionWallet)) {
    return { ok: false, status: 403, error: "Wallet does not own this launch" };
  }
  return { ok: true, launch };
}

export function lamportsToSol(lamports: bigint | string): string {
  const value = typeof lamports === "string" ? BigInt(lamports || "0") : lamports;
  return (Number(value) / 1_000_000_000).toFixed(6);
}

export function weiToEth(wei: bigint): string {
  return formatEther(wei);
}
