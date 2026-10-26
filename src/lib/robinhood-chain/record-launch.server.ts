import "server-only";
import {
  getAddress,
  isAddress,
  parseAbiItem,
  type Hex,
} from "viem";
import type {
  Prisma,
  RobinhoodLaunchPreparation,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import {
  ROBINHOOD_CHAIN_CONFIG,
} from "@/lib/robinhood-chain/config";
import { decodeLaunchLogoFromTxInput } from "@/lib/robinhood-chain/decode-launch-tx";
import {
  ROBINHOOD_LAUNCH_ERROR,
  RobinhoodLaunchError,
} from "@/lib/robinhood-chain/errors";
import { resolveRobinhoodFeeSplitPlan } from "@/lib/robinhood-chain/fee-splitter.server";
import { serializeRobinhoodLaunch } from "@/lib/robinhood-chain/serialize";
import type { RobinhoodLaunchFormFields } from "@/lib/robinhood-chain/types";
import {
  parseTokenLaunchedFromReceipt,
  readRobinhoodTokenOnChain,
  robinhoodLaunchDefaults,
  verifyRobinhoodLaunchSource,
  type TokenLaunchedEvent,
} from "@/lib/robinhood-chain/verify-launch.server";
const TRANSACTION_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const PREPARATION_ID_MAX = 128;
const PREPARATION_BLOCK_GRACE_MS = 10 * 60 * 1000;
const PREPARATION_CLOCK_SKEW_MS = 5 * 60 * 1000;
const TOKEN_CREATED_EVENT = parseAbiItem(
  "event TokenCreated(address msgSender, address indexed tokenAddress, address indexed tokenAdmin, string tokenImage, string tokenName, string tokenSymbol, string tokenMetadata, string tokenContext, int24 startingTick, address poolHook, bytes32 poolId, address pairedToken, address locker, address mevModule, uint256 extensionsSupply, address[] extensions)",
);
function normalizeTransactionHash(value: string): `0x${string}` {
  const normalized = value.trim();
  if (!TRANSACTION_HASH_RE.test(normalized)) {
    throw new Error("Invalid transaction hash.");
  }
  return normalized.toLowerCase() as `0x${string}`;
}
function normalizePreparationId(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  if (normalized.length > PREPARATION_ID_MAX || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_NOT_FOUND);
  }
  return normalized;
}
function normalizeForm(fields?: Partial<RobinhoodLaunchFormFields>) {
  const trim = (value?: string | null) => {
    const normalized = (value ?? "").trim();
    return normalized || undefined;
  };
  return {
    tokenName: trim(fields?.tokenName),
    tokenSymbol: trim(fields?.tokenSymbol),
    tokenDescription: trim(fields?.tokenDescription),
    tokenImageUrl: trim(fields?.tokenImageUrl),
    tokenImageOriginalUrl: trim(fields?.tokenImageOriginalUrl),
    tokenLogoIpfsCid: trim(fields?.tokenLogoIpfsCid),
    tokenLogoIpfsUri: trim(fields?.tokenLogoIpfsUri),
    tokenLogoGatewayUrl: trim(fields?.tokenLogoGatewayUrl),
    onChainLogoUrl: trim(fields?.onChainLogoUrl),
    website: trim(fields?.website),
    twitter: trim(fields?.twitter),
    telegram: trim(fields?.telegram),
    discord: trim(fields?.discord),
    farcaster: trim(fields?.farcaster),
    agentDbId:
      fields?.agentDbId != null && Number.isFinite(fields.agentDbId) && fields.agentDbId > 0
        ? fields.agentDbId
        : undefined,
  };
}
function metadataFromPreparation(
  preparation: RobinhoodLaunchPreparation,
  onChainLogo: string | undefined,
): Partial<RobinhoodLaunchFormFields> {
  return {
    tokenName: preparation.tokenName,
    tokenSymbol: preparation.tokenSymbol,
    tokenDescription: preparation.tokenDescription ?? undefined,
    tokenImageOriginalUrl: preparation.tokenImageOriginalUrl,
    tokenLogoIpfsCid: preparation.tokenLogoIpfsCid,
    tokenLogoIpfsUri: preparation.tokenLogoIpfsUri,
    tokenLogoGatewayUrl: preparation.tokenLogoGatewayUrl,
    tokenImageUrl: onChainLogo ?? preparation.tokenLogoGatewayUrl,
    website: preparation.website ?? undefined,
    twitter: preparation.twitter ?? undefined,
    telegram: preparation.telegram ?? undefined,
    discord: preparation.discord ?? undefined,
    farcaster: preparation.farcaster ?? undefined,
    agentDbId: preparation.agentDbId ?? undefined,
    onChainLogoUrl: onChainLogo ?? preparation.tokenLogoGatewayUrl,
  };
}
function assertPreparationMatchesTransaction(input: {
  preparation: RobinhoodLaunchPreparation;
  txHash: string;
  tx: {
    from: string;
    to: string | null;
    input: string;
    value: bigint;
  };
  blockTimestamp: Date;
  existingTxHash: string | null;
}): void {
  const { preparation, txHash, tx, blockTimestamp, existingTxHash } = input;
  const consumedTxHash = preparation.consumedTxHash?.toLowerCase() ?? null;
  if (preparation.consumedAt) {
    const legacyIdempotentConsumption = consumedTxHash === null && existingTxHash === txHash;
    if (consumedTxHash !== txHash && !legacyIdempotentConsumption) {
      throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_USED);
    }
  }
  const earliestAllowed = preparation.createdAt.getTime() - PREPARATION_CLOCK_SKEW_MS;
  const latestAllowed = preparation.expiresAt.getTime() + PREPARATION_BLOCK_GRACE_MS;
  const minedAt = blockTimestamp.getTime();
  if (minedAt < earliestAllowed || minedAt > latestAllowed) {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_EXPIRED);
  }
  let preparedValue: bigint;
  try {
    preparedValue = BigInt(preparation.preparedValue);
  } catch {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_MISMATCH);
  }
  const fromMatches = getAddress(tx.from).toLowerCase() === getAddress(preparation.creatorWallet).toLowerCase();
  const toMatches =
    tx.to !== null && getAddress(tx.to).toLowerCase() === getAddress(preparation.preparedTo).toLowerCase();
  const dataMatches = tx.input.toLowerCase() === preparation.preparedData.toLowerCase();
  const valueMatches = tx.value === preparedValue;
  if (!fromMatches || !toMatches || !dataMatches || !valueMatches) {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_MISMATCH);
  }
}
async function loadEventFromTx(
  txHash: `0x${string}`,
  client = createRobinhoodPublicClient(),
): Promise<{
  event: TokenLaunchedEvent;
  blockNumber: bigint;
  blockTimestamp: Date;
}> {
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      pollingInterval: 2_000,
      timeout: 120_000,
    });
  } catch {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.RECEIPT_TIMEOUT);
  }
  if (receipt.status === "reverted") {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.TX_REVERTED);
  }
  const event = parseTokenLaunchedFromReceipt(receipt.logs);
  if (!event) {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.EVENT_NOT_FOUND);
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return {
    event,
    blockNumber: receipt.blockNumber,
    blockTimestamp: new Date(Number(block.timestamp) * 1000),
  };
}
async function loadEventFromToken(tokenAddress: string): Promise<{
  event: TokenLaunchedEvent;
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockTimestamp: Date;
} | null> {
  const client = createRobinhoodPublicClient();
  const token = getAddress(tokenAddress);
  const logs = await client.getLogs({
    address: ROBINHOOD_CHAIN_CONFIG.launchFactory,
    event: TOKEN_CREATED_EVENT,
    args: { tokenAddress: token },
    fromBlock: BigInt(ROBINHOOD_CHAIN_CONFIG.launchFactoryStartBlock),
    toBlock: "latest",
  });
  for (const log of logs) {
    const event = parseTokenLaunchedFromReceipt([log]);
    if (!event || !log.transactionHash || log.blockNumber == null) continue;
    const block = await client.getBlock({ blockNumber: log.blockNumber });
    return {
      event,
      txHash: normalizeTransactionHash(log.transactionHash),
      blockNumber: log.blockNumber,
      blockTimestamp: new Date(Number(block.timestamp) * 1000),
    };
  }
  return null;
}
type LaunchPersistence = {
  tokenAddress: string;
  create: Prisma.RobinhoodChainLaunchUncheckedCreateInput;
  update: Prisma.RobinhoodChainLaunchUncheckedUpdateInput;
};
async function buildLaunchPersistence(input: {
  event: TokenLaunchedEvent;
  txHash: string;
  blockNumber: bigint;
  blockTimestamp: Date;
  form?: Partial<RobinhoodLaunchFormFields>;
  launchedViaAgentRanking: boolean;
  signerWallet?: string | null;
}): Promise<LaunchPersistence> {
  const defaults = robinhoodLaunchDefaults();
  const meta = normalizeForm(input.form);
  const tokenAddress = getAddress(input.event.token);
  const sourceVerified = await verifyRobinhoodLaunchSource(tokenAddress);
  const onChain = await readRobinhoodTokenOnChain(tokenAddress);
  const creatorWallet = input.signerWallet?.trim()
    ? getAddress(input.signerWallet)
    : getAddress(input.event.deployer);
  const creatorRecipient = onChain.creatorRecipient
    ? getAddress(onChain.creatorRecipient)
    : null;
  const feeSplit = creatorRecipient && creatorRecipient !== creatorWallet
    ? await resolveRobinhoodFeeSplitPlan(creatorWallet).catch(() => null)
    : null;
  if (!sourceVerified) {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.SOURCE_VERIFICATION_FAILED);
  }
  const feeSplitFields = feeSplit?.enabled
    && feeSplit.splitter
    && getAddress(feeSplit.splitter) === creatorRecipient
    ? {
        feeSplitterAddress: creatorRecipient,
        creatorFeeBps: feeSplit.creatorFeeBps,
        protocolFeeBps: feeSplit.arFeeBps,
      }
    : creatorRecipient === creatorWallet
      ? {
          feeSplitterAddress: null,
          creatorFeeBps: 10_000,
          protocolFeeBps: 0,
        }
      : {};
  const canonicalTokenName = (meta.tokenName ?? onChain.name?.trim()) || undefined;
  const canonicalTokenSymbol = (meta.tokenSymbol ?? onChain.symbol?.trim()) || undefined;
  const canonicalImageUrl = (meta.tokenImageUrl ?? onChain.image?.trim()) || undefined;
  const canonicalOnChainLogoUrl = (meta.onChainLogoUrl ?? onChain.image?.trim()) || undefined;
  const toDb = (value: string | undefined) => value ?? null;
  const metadataCreate = {
    tokenName: toDb(canonicalTokenName),
    tokenSymbol: toDb(canonicalTokenSymbol),
    tokenDescription: toDb(meta.tokenDescription),
    tokenImageUrl: toDb(canonicalImageUrl),
    tokenImageOriginalUrl: toDb(meta.tokenImageOriginalUrl),
    tokenLogoIpfsCid: toDb(meta.tokenLogoIpfsCid),
    tokenLogoIpfsUri: toDb(meta.tokenLogoIpfsUri),
    tokenLogoGatewayUrl: toDb(meta.tokenLogoGatewayUrl),
    onChainLogoUrl: toDb(canonicalOnChainLogoUrl),
    website: toDb(meta.website),
    twitter: toDb(meta.twitter),
    telegram: toDb(meta.telegram),
    discord: toDb(meta.discord),
    farcaster: toDb(meta.farcaster),
    agentDbId: meta.agentDbId ?? null,
  };
  const metadataUpdate: Prisma.RobinhoodChainLaunchUncheckedUpdateInput =
    input.launchedViaAgentRanking
      ? metadataCreate
      : {
          ...(canonicalTokenName !== undefined ? { tokenName: canonicalTokenName } : {}),
          ...(canonicalTokenSymbol !== undefined ? { tokenSymbol: canonicalTokenSymbol } : {}),
          ...(meta.tokenDescription !== undefined ? { tokenDescription: meta.tokenDescription } : {}),
          ...(canonicalImageUrl !== undefined ? { tokenImageUrl: canonicalImageUrl } : {}),
          ...(meta.tokenImageOriginalUrl !== undefined ? { tokenImageOriginalUrl: meta.tokenImageOriginalUrl } : {}),
          ...(meta.tokenLogoIpfsCid !== undefined ? { tokenLogoIpfsCid: meta.tokenLogoIpfsCid } : {}),
          ...(meta.tokenLogoIpfsUri !== undefined ? { tokenLogoIpfsUri: meta.tokenLogoIpfsUri } : {}),
          ...(meta.tokenLogoGatewayUrl !== undefined ? { tokenLogoGatewayUrl: meta.tokenLogoGatewayUrl } : {}),
          ...(canonicalOnChainLogoUrl !== undefined ? { onChainLogoUrl: canonicalOnChainLogoUrl } : {}),
          ...(meta.website !== undefined ? { website: meta.website } : {}),
          ...(meta.twitter !== undefined ? { twitter: meta.twitter } : {}),
          ...(meta.telegram !== undefined ? { telegram: meta.telegram } : {}),
          ...(meta.discord !== undefined ? { discord: meta.discord } : {}),
          ...(meta.farcaster !== undefined ? { farcaster: meta.farcaster } : {}),
          ...(meta.agentDbId !== undefined ? { agentDbId: meta.agentDbId } : {}),
        };
  const common = {
    creatorWallet,
    poolAddress: getAddress(input.event.pool),
    pairToken: getAddress(input.event.pairToken),
    dexFactory: getAddress(input.event.dexFactory),
    dexId: Number(input.event.dexId),
    launchConfigId: Number(input.event.launchConfigId),
    positionId: input.event.positionId.toString(),
    restrictionsEndBlock: input.event.restrictionsEndBlock.toString(),
    initialBuyAmount: input.event.initialBuyAmount.toString(),
    txHash: input.txHash,
    blockNumber: input.blockNumber.toString(),
    blockTimestamp: input.blockTimestamp,
    sourceVerified,
    ...feeSplitFields,
    decimals: onChain.decimals,
    totalSupply: onChain.totalSupply,
    onChainPoolFee: onChain.poolFee,
    maxWalletLimit: onChain.maxWalletLimit,
    maxTxLimit: onChain.maxTxLimit,
    onChainRestrictionEndBlock: onChain.restrictionEndBlock,
  } satisfies Prisma.RobinhoodChainLaunchUncheckedUpdateInput;
  return {
    tokenAddress,
    create: {
      tokenAddress,
      ...common,
      ...metadataCreate,
      chainId: defaults.chainId,
      source: defaults.source,
      frontendSourceLabel: defaults.frontendSourceLabel,
      launchedViaAgentRanking: input.launchedViaAgentRanking,
    },
    update: {
      ...common,
      ...metadataUpdate,
      ...(input.launchedViaAgentRanking
        ? {
            launchedViaAgentRanking: true,
            source: defaults.source,
            frontendSourceLabel: defaults.frontendSourceLabel,
          }
        : {}),
    },
  };
}
async function persistLaunchAndConsumePreparation(input: {
  persistence: LaunchPersistence;
  preparationId: string | null;
  txHash: string;
}) {
  return prisma.$transaction(async (tx) => {
    if (input.preparationId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`robinhood-launch-preparation:${input.preparationId}`}, 0))`;
      const preparation = await tx.robinhoodLaunchPreparation.findUnique({
        where: { id: input.preparationId },
        select: { consumedAt: true, consumedTxHash: true },
      });
      if (!preparation) {
        throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_NOT_FOUND);
      }
      const consumedTxHash = preparation.consumedTxHash?.toLowerCase() ?? null;
      if (preparation.consumedAt && consumedTxHash !== input.txHash) {
        const legacyExisting = consumedTxHash === null
          ? await tx.robinhoodChainLaunch.findUnique({
              where: { txHash: input.txHash },
              select: { id: true },
            })
          : null;
        if (!legacyExisting) {
          throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_USED);
        }
      }
    }
    const row = await tx.robinhoodChainLaunch.upsert({
      where: { tokenAddress: input.persistence.tokenAddress },
      create: input.persistence.create,
      update: input.persistence.update,
    });
    if (input.preparationId) {
      const consumed = await tx.robinhoodLaunchPreparation.updateMany({
        where: {
          id: input.preparationId,
          consumedAt: null,
        },
        data: {
          consumedAt: new Date(),
          consumedTxHash: input.txHash,
        },
      });
      if (consumed.count === 0) {
        const preparation = await tx.robinhoodLaunchPreparation.findUnique({
          where: { id: input.preparationId },
          select: { consumedAt: true, consumedTxHash: true },
        });
        const consumedTxHash = preparation?.consumedTxHash?.toLowerCase() ?? null;
        const legacyIdempotent = preparation?.consumedAt && consumedTxHash === null
          ? await tx.robinhoodChainLaunch.findUnique({
              where: { txHash: input.txHash },
              select: { id: true },
            })
          : null;
        if (consumedTxHash !== input.txHash && !legacyIdempotent) {
          throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_USED);
        }
      }
    }
    return row;
  });
}
export async function getRobinhoodLaunchPreparationAccess(preparationId: string): Promise<{
  creatorWallet: string;
  agentDbId: number | null;
} | null> {
  const id = normalizePreparationId(preparationId);
  if (!id) return null;
  return prisma.robinhoodLaunchPreparation.findUnique({
    where: { id },
    select: { creatorWallet: true, agentDbId: true },
  });
}
export async function recordRobinhoodLaunchFromTx(input: {
  txHash: string;
  form?: Partial<RobinhoodLaunchFormFields>;
  preparationId?: string | null;
  launchedViaAgentRanking?: boolean;
}) {
  const txHash = normalizeTransactionHash(input.txHash);
  const launchedViaAgentRanking = input.launchedViaAgentRanking ?? true;
  const preparationId = normalizePreparationId(input.preparationId);
  if (launchedViaAgentRanking && !preparationId) {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_REQUIRED);
  }
  const client = createRobinhoodPublicClient();
  const [transaction, eventResult, existing] = await Promise.all([
    client.getTransaction({ hash: txHash as Hex }),
    loadEventFromTx(txHash, client),
    prisma.robinhoodChainLaunch.findUnique({ where: { txHash } }),
  ]);
  const onChainLogo = decodeLaunchLogoFromTxInput(transaction.input) ?? undefined;
  let resolvedForm = normalizeForm(input.form);
  let preparation: RobinhoodLaunchPreparation | null = null;
  if (preparationId) {
    preparation = await prisma.robinhoodLaunchPreparation.findUnique({ where: { id: preparationId } });
    if (!preparation) {
      throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.PREPARATION_NOT_FOUND);
    }
    assertPreparationMatchesTransaction({
      preparation,
      txHash,
      tx: {
        from: transaction.from,
        to: transaction.to,
        input: transaction.input,
        value: transaction.value,
      },
      blockTimestamp: eventResult.blockTimestamp,
      existingTxHash: existing?.txHash.toLowerCase() ?? null,
    });
    resolvedForm = normalizeForm(metadataFromPreparation(preparation, onChainLogo));
  } else if (onChainLogo) {
    resolvedForm.onChainLogoUrl = onChainLogo;
    resolvedForm.tokenImageUrl = onChainLogo;
  }
  if (!resolvedForm.tokenImageUrl && resolvedForm.tokenLogoGatewayUrl) {
    resolvedForm.tokenImageUrl = resolvedForm.tokenLogoGatewayUrl;
  }
  const persistence = await buildLaunchPersistence({
    event: eventResult.event,
    txHash,
    blockNumber: eventResult.blockNumber,
    blockTimestamp: eventResult.blockTimestamp,
    form: resolvedForm,
    launchedViaAgentRanking,
    signerWallet: launchedViaAgentRanking ? transaction.from : null,
  });
  const row = await persistLaunchAndConsumePreparation({
    persistence,
    preparationId,
    txHash,
  });
  return serializeRobinhoodLaunch(row);
}
export async function importRobinhoodLaunch(input: {
  tokenAddress?: string;
  txHash?: string;
  form?: Partial<RobinhoodLaunchFormFields>;
}) {
  if (input.txHash?.trim()) {
    return recordRobinhoodLaunchFromTx({
      txHash: input.txHash,
      form: input.form,
      launchedViaAgentRanking: false,
    });
  }
  const tokenRaw = input.tokenAddress?.trim();
  if (!tokenRaw || !isAddress(tokenRaw)) {
    throw new Error("tokenAddress or txHash is required.");
  }
  const tokenAddress = getAddress(tokenRaw);
  const eventResult = await loadEventFromToken(tokenAddress);
  if (!eventResult) throw new Error("Token is not a verified Robinhood Chain launch.");
  const persistence = await buildLaunchPersistence({
    event: eventResult.event,
    txHash: eventResult.txHash,
    blockNumber: eventResult.blockNumber,
    blockTimestamp: eventResult.blockTimestamp,
    form: input.form,
    launchedViaAgentRanking: false,
  });
  const row = await persistLaunchAndConsumePreparation({
    persistence,
    preparationId: null,
    txHash: eventResult.txHash,
  });
  return serializeRobinhoodLaunch(row);
}
export async function listRobinhoodLaunches(limit = 50) {
  const rows = await prisma.robinhoodChainLaunch.findMany({
    orderBy: { blockTimestamp: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
  });
  return rows.map(serializeRobinhoodLaunch);
}
export async function getLatestRobinhoodLaunchForAgent(agentDbId: number) {
  if (!Number.isFinite(agentDbId) || agentDbId <= 0) return null;
  const row = await prisma.robinhoodChainLaunch.findFirst({
    where: { agentDbId },
    orderBy: { blockTimestamp: "desc" },
  });
  return row ? serializeRobinhoodLaunch(row) : null;
}
export async function getRobinhoodLaunchByAddress(address: string) {
  if (!isAddress(address)) return null;
  const row = await prisma.robinhoodChainLaunch.findUnique({
    where: { tokenAddress: getAddress(address) },
  });
  return row ? serializeRobinhoodLaunch(row) : null;
}
