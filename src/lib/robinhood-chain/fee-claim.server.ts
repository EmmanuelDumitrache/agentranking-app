import "server-only";
import {
  decodeEventLog,
  decodeFunctionData,
  encodeFunctionData,
  formatEther,
  getAddress,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { prisma } from "@/lib/db";
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import { ROBINHOOD_CHAIN_CONFIG, ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
import { RobinhoodLaunchError, ROBINHOOD_LAUNCH_ERROR } from "@/lib/robinhood-chain/errors";
import {
  resolveRobinhoodFeeSplitPlan,
} from "@/lib/robinhood-chain/fee-splitter.server";
import {
  getRobinhoodArFeeTreasury,
  robinhoodCreatorFeeSplitterAbi,
  robinhoodFeeSplitterFactoryAbi,
} from "@/lib/robinhood-chain/fee-splitter";
import {
  quiverFactoryV3Abi,
  quiverFeeLockerAbi,
  quiverLpLockerV3Abi,
} from "@/lib/robinhood-chain/quiver-abis";
const WETH = getAddress(ROBINHOOD_CHAIN_CONFIG.weth);
const TRANSFER_ABI = [{
  type: "event",
  name: "Transfer",
  anonymous: false,
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;
type ClaimAsset = { claimedAsset: Address; claimedRawAmount: string };
export type RobinhoodClaimableFees = {
  claimableWei: bigint;
  claimableWeth: string;
  claimableTokenRaw: bigint;
  grossCollectWei: bigint;
  protocolFeeShareBps: number;
  locker: string;
  feeLocker: string;
  tokenAddress: string;
  poolAddress: string | null;
  positionId: string;
  creatorWallet: string;
  feeRecipient: string;
  feeSplitEnabled: boolean;
  creatorFeeBps: number;
  arFeeBps: number;
  positionManager: string;
  canClaim: boolean;
  reason?: string;
  checkedAt: string;
};
function assertHash(value: string): Hex {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) throw new Error("Invalid claim transaction hash");
  return value as Hex;
}
async function deployment(token: Address) {
  const client = createRobinhoodPublicClient();
  const result = await client.readContract({
    address: ROBINHOOD_CHAIN_CONFIG.launchFactory,
    abi: quiverFactoryV3Abi,
    functionName: "deploymentInfoForToken",
    args: [token],
  });
  const [pool, startingTick, creatorRecipient] = result;
  if (getAddress(pool) === zeroAddress) throw new Error("Not a verified Quiver launch on Robinhood Chain.");
  return { pool: getAddress(pool), startingTick: Number(startingTick), creatorRecipient: getAddress(creatorRecipient) };
}
async function verifyRecipient(input: {
  creator: Address;
  creatorRecipient: Address;
}) {
  if (input.creatorRecipient === input.creator) {
    return {
      splitEnabled: false,
      splitter: null as Address | null,
      plan: {
        enabled: false,
        factory: null,
        splitter: null,
        splitterDeployed: false,
        creatorWallet: input.creator,
        arTreasury: getAddress(getRobinhoodArFeeTreasury()),
        creatorFeeBps: 10_000,
        arFeeBps: 0,
        label: "100% creator (legacy launch)",
      },
    };
  }
  const plan = await resolveRobinhoodFeeSplitPlan(input.creator);
  if (!plan.enabled || !plan.splitter || plan.splitter !== input.creatorRecipient) {
    throw new Error("On-chain Quiver fee recipient does not match the deterministic splitter.");
  }
  return { splitEnabled: true, splitter: plan.splitter, plan };
}
export async function getRobinhoodClaimableFeesForLaunch(input: {
  tokenAddress: string;
  creatorWallet: string;
  poolAddress?: string | null;
  positionId?: string | null;
  feeSplitterAddress?: string | null;
}): Promise<RobinhoodClaimableFees> {
  const token = getAddress(input.tokenAddress);
  const creator = getAddress(input.creatorWallet);
  const info = await deployment(token);
  const recipient = await verifyRecipient({ creator, creatorRecipient: info.creatorRecipient });
  const client = createRobinhoodPublicClient();
  const [wethFees, tokenFees] = await Promise.all([
    client.readContract({ address: ROBINHOOD_CHAIN_CONFIG.feeLocker, abi: quiverFeeLockerAbi, functionName: "availableFees", args: [info.creatorRecipient, WETH] }),
    client.readContract({ address: ROBINHOOD_CHAIN_CONFIG.feeLocker, abi: quiverFeeLockerAbi, functionName: "availableFees", args: [info.creatorRecipient, token] }),
  ]);
  const canClaim = true;
  const reason = wethFees === 0n && tokenFees === 0n
    ? "No indexed fee-locker balance yet. Quiver LP rewards may still be collectable."
    : undefined;
  return {
    claimableWei: wethFees,
    claimableWeth: formatEther(wethFees),
    claimableTokenRaw: tokenFees,
    grossCollectWei: wethFees,
    protocolFeeShareBps: 0,
    locker: ROBINHOOD_CHAIN_CONFIG.launchLocker,
    feeLocker: ROBINHOOD_CHAIN_CONFIG.feeLocker,
    tokenAddress: token,
    poolAddress: input.poolAddress?.trim() ? getAddress(input.poolAddress) : info.pool,
    positionId: input.positionId?.trim() || "0",
    creatorWallet: creator,
    feeRecipient: info.creatorRecipient,
    feeSplitEnabled: recipient.splitEnabled,
    creatorFeeBps: recipient.splitEnabled ? recipient.plan.creatorFeeBps : 10_000,
    arFeeBps: recipient.splitEnabled ? recipient.plan.arFeeBps : 0,
    positionManager: ROBINHOOD_CHAIN_CONFIG.launchLocker,
    canClaim,
    reason,
    checkedAt: new Date().toISOString(),
  };
}
export async function prepareRobinhoodFeeClaimTransaction(input: {
  tokenAddress: string;
  creatorWallet: string;
  feeSplitterAddress?: string | null;
  force?: boolean;
}) {
  const token = getAddress(input.tokenAddress);
  const creator = getAddress(input.creatorWallet);
  const info = await deployment(token);
  const recipient = await verifyRecipient({ creator, creatorRecipient: info.creatorRecipient });
  const fees = await getRobinhoodClaimableFeesForLaunch(input);
  if (!input.force && fees.claimableWei === 0n && fees.claimableTokenRaw === 0n) {
    // collectRewards can discover unindexed LP rewards, so this is advisory rather than a hard failure.
  }
  const steps: Array<{ kind: string; chainId: number; to: string; data: Hex; value: "0"; label: string; optional?: boolean }> = [];
  if (recipient.splitEnabled && !recipient.plan.splitterDeployed) {
    if (!recipient.plan.factory) throw new Error("Robinhood fee splitter factory is not configured.");
    steps.push({
      kind: "deploy_splitter",
      chainId: ROBINHOOD_CHAIN_ID,
      to: recipient.plan.factory,
      data: encodeFunctionData({ abi: robinhoodFeeSplitterFactoryAbi, functionName: "deploy", args: [creator] }),
      value: "0",
      label: "Deploy deterministic fee splitter",
    });
  }
  const collectData = encodeFunctionData({ abi: quiverLpLockerV3Abi, functionName: "collectRewards", args: [token] });
  steps.push({ kind: "collect_rewards", chainId: ROBINHOOD_CHAIN_ID, to: ROBINHOOD_CHAIN_CONFIG.launchLocker, data: collectData, value: "0", label: "Collect Quiver LP rewards" });
  if (fees.claimableWei > 0n) {
    steps.push({ kind: "claim_fee_locker_weth", chainId: ROBINHOOD_CHAIN_ID, to: ROBINHOOD_CHAIN_CONFIG.feeLocker, data: encodeFunctionData({ abi: quiverFeeLockerAbi, functionName: "claim", args: [info.creatorRecipient, WETH] }), value: "0", label: "Claim indexed WETH fees" });
  }
  if (fees.claimableTokenRaw > 0n) {
    steps.push({ kind: "claim_fee_locker_token", chainId: ROBINHOOD_CHAIN_ID, to: ROBINHOOD_CHAIN_CONFIG.feeLocker, data: encodeFunctionData({ abi: quiverFeeLockerAbi, functionName: "claim", args: [info.creatorRecipient, token] }), value: "0", label: "Claim indexed token fees" });
  }
  if (recipient.splitEnabled && recipient.splitter) {
    steps.push(
      { kind: "sweep_splitter_weth", chainId: ROBINHOOD_CHAIN_ID, to: recipient.splitter, data: encodeFunctionData({ abi: robinhoodCreatorFeeSplitterAbi, functionName: "sweep" }), value: "0", label: "Split WETH fees 70/30", optional: true },
      { kind: "sweep_splitter_token", chainId: ROBINHOOD_CHAIN_ID, to: recipient.splitter, data: encodeFunctionData({ abi: robinhoodCreatorFeeSplitterAbi, functionName: "sweepToken", args: [token] }), value: "0", label: "Split token fees 70/30", optional: true },
    );
  }
  const primary = steps[0]!;
  let gasSuggestion: string | undefined;
  try {
    const estimate = await createRobinhoodPublicClient().estimateGas({ account: creator, to: getAddress(primary.to), data: primary.data, value: 0n });
    gasSuggestion = ((estimate * 120n) / 100n).toString();
  } catch { /* wallet estimates each step independently */ }
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    to: primary.to,
    data: primary.data,
    value: primary.value,
    expectedRecipient: info.creatorRecipient,
    claimableWei: fees.claimableWei.toString(),
    claimableWeth: fees.claimableWeth,
    claimableTokenRaw: fees.claimableTokenRaw.toString(),
    gasSuggestion,
    feeSplit: {
      enabled: recipient.splitEnabled,
      label: recipient.splitEnabled ? recipient.plan.label : "100% creator (legacy launch)",
      splitter: recipient.splitter,
      arTreasury: recipient.plan.arTreasury,
      creatorFeeBps: recipient.splitEnabled ? recipient.plan.creatorFeeBps : 10_000,
      arFeeBps: recipient.splitEnabled ? recipient.plan.arFeeBps : 0,
    },
    steps,
    fallbackStep: null,
  };
}
function addAmount(map: Map<Address, bigint>, asset: Address, amount: bigint) {
  if (amount > 0n) map.set(asset, (map.get(asset) ?? 0n) + amount);
}
export async function recordRobinhoodFeeClaimFromTx(input: {
  launchId: string;
  agentDbId: number;
  tokenAddress: string;
  positionId: string;
  creatorWallet: string;
  claimTxHash: string;
  feeSplitterAddress?: string | null;
}): Promise<{ status: "confirmed" | "failed"; claimedRawAmount: string; assets: ClaimAsset[] }> {
  const token = getAddress(input.tokenAddress);
  const creator = getAddress(input.creatorWallet);
  const hash = assertHash(input.claimTxHash);
  const client = createRobinhoodPublicClient();
  const [transaction, receipt, info] = await Promise.all([
    client.getTransaction({ hash }),
    client.waitForTransactionReceipt({ hash, pollingInterval: 2_000, timeout: 120_000 }),
    deployment(token),
  ]);
  if (getAddress(transaction.from) !== creator) throw new Error("Claim transaction signer does not match launch creator.");
  if (!transaction.to) throw new Error("Claim transaction has no destination.");
  const to = getAddress(transaction.to);
  const recipient = await verifyRecipient({ creator, creatorRecipient: info.creatorRecipient });
  const allowed = new Set<Address>([
    getAddress(ROBINHOOD_CHAIN_CONFIG.launchLocker),
    getAddress(ROBINHOOD_CHAIN_CONFIG.feeLocker),
    ...(recipient.splitEnabled && !recipient.plan.splitterDeployed && recipient.plan.factory
      ? [getAddress(recipient.plan.factory)]
      : []),
    ...(recipient.splitEnabled && recipient.splitter ? [recipient.splitter] : []),
  ]);
  if (!allowed.has(to)) throw new Error("Claim transaction destination is not part of the approved Quiver claim flow.");
  if (receipt.status === "reverted") throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.TX_REVERTED);
  // Validate calldata for every supported claim-flow destination.
  if (to === getAddress(ROBINHOOD_CHAIN_CONFIG.launchLocker)) {
    const decoded = decodeFunctionData({ abi: quiverLpLockerV3Abi, data: transaction.input });
    if (decoded.functionName !== "collectRewards" || getAddress(decoded.args[0]) !== token) throw new Error("Unexpected Quiver reward calldata.");
  } else if (to === getAddress(ROBINHOOD_CHAIN_CONFIG.feeLocker)) {
    const decoded = decodeFunctionData({ abi: quiverFeeLockerAbi, data: transaction.input });
    if (decoded.functionName !== "claim") throw new Error("Unexpected Quiver fee-locker calldata.");
    const [owner, asset] = decoded.args;
    if (getAddress(owner) !== info.creatorRecipient || ![WETH, token].includes(getAddress(asset))) throw new Error("Unexpected Quiver fee claim arguments.");
  } else if (recipient.splitter && to === recipient.splitter) {
    const decoded = decodeFunctionData({ abi: robinhoodCreatorFeeSplitterAbi, data: transaction.input });
    if (decoded.functionName === "sweepToken" && getAddress(decoded.args[0]) !== token) throw new Error("Unexpected splitter token.");
    if (decoded.functionName !== "sweep" && decoded.functionName !== "sweepToken") throw new Error("Unexpected splitter calldata.");
  } else if (
    recipient.splitEnabled
    && !recipient.plan.splitterDeployed
    && recipient.plan.factory
    && to === getAddress(recipient.plan.factory)
  ) {
    const decoded = decodeFunctionData({ abi: robinhoodFeeSplitterFactoryAbi, data: transaction.input });
    if (decoded.functionName !== "deploy" || getAddress(decoded.args[0]) !== creator) throw new Error("Unexpected splitter deployment calldata.");
  }
  // Quiver's RewardsCollected event and ERC-20 Transfer logs describe the same
  // payout in some transactions. Keep them separately and prefer observable
  // transfers so a single claim is never double-counted.
  const eventAmounts = new Map<Address, bigint>();
  const transferAmounts = new Map<Address, bigint>();
  for (const log of receipt.logs) {
    const logAddress = getAddress(log.address);
    if (logAddress === getAddress(ROBINHOOD_CHAIN_CONFIG.launchLocker)) {
      try {
        const event = decodeEventLog({ abi: quiverLpLockerV3Abi, eventName: "RewardsCollected", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (getAddress(event.args.token) === token) {
          addAmount(eventAmounts, getAddress(event.args.currency0), event.args.amount0);
          addAmount(eventAmounts, getAddress(event.args.currency1), event.args.amount1);
        }
      } catch { /* not this event */ }
    }
    if (logAddress !== WETH && logAddress !== token) continue;
    try {
      const event = decodeEventLog({ abi: TRANSFER_ABI, eventName: "Transfer", data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      const destination = getAddress(event.args.to);
      // Persist only terminal payouts. Transfers into the deterministic splitter
      // are intermediate custody and are later represented by its creator and
      // treasury payout logs; counting both would double the claimed amount.
      if (
        destination === creator
        || (recipient.splitEnabled && destination === getAddress(recipient.plan.arTreasury))
      ) {
        addAmount(transferAmounts, logAddress, event.args.value);
      }
    } catch { /* not Transfer */ }
  }
  const amounts = new Map<Address, bigint>();
  for (const asset of [WETH, token] as const) {
    const transferred = transferAmounts.get(asset) ?? 0n;
    // RewardsCollected is a safe fallback only for legacy direct-recipient
    // launches. In split mode it describes an intermediate transfer into the
    // splitter and must not be recorded as a terminal payout.
    const emitted = recipient.splitEnabled ? 0n : (eventAmounts.get(asset) ?? 0n);
    addAmount(amounts, asset, transferred > 0n ? transferred : emitted);
  }
  const assets = [...amounts.entries()].map(([claimedAsset, amount]) => ({
    claimedAsset,
    claimedRawAmount: amount.toString(),
  }));
  if (assets.length > 0) {
    const confirmedAt = new Date();
    await prisma.$transaction(
      assets.map((asset) =>
        prisma.robinhoodFeeClaim.upsert({
          where: {
            claimTxHash_claimedAsset: {
              claimTxHash: hash,
              claimedAsset: asset.claimedAsset,
            },
          },
          create: {
            launchId: input.launchId,
            agentDbId: input.agentDbId,
            tokenAddress: token,
            positionId: input.positionId,
            creatorWallet: creator,
            lockerAddress: to,
            claimTxHash: hash,
            claimedAsset: asset.claimedAsset,
            claimedRawAmount: asset.claimedRawAmount,
            status: "confirmed",
            confirmedAt,
          },
          update: {
            claimedRawAmount: asset.claimedRawAmount,
            status: "confirmed",
            confirmedAt,
            failureReason: null,
          },
        }),
      ),
    );
  }
  return { status: "confirmed", claimedRawAmount: assets.find((asset) => asset.claimedAsset === WETH)?.claimedRawAmount ?? "0", assets };
}
