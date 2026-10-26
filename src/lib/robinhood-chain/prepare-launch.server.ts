import "server-only";
import {
  encodeFunctionData,
  formatEther,
  getAddress,
} from "viem";
import { prisma } from "@/lib/db";
import {
  ROBINHOOD_CHAIN_CONFIG,
  ROBINHOOD_CHAIN_ID,
} from "@/lib/robinhood-chain/config";
import { createRobinhoodPublicClient } from "@/lib/robinhood-chain/client";
import { RobinhoodLaunchError, ROBINHOOD_LAUNCH_ERROR } from "@/lib/robinhood-chain/errors";
import { prepareRobinhoodTokenLogo } from "@/lib/robinhood-chain/prepare-logo.server";
import { quiverFactoryV3Abi } from "@/lib/robinhood-chain/quiver-abis";
import { buildQuiverV3DeployArgs } from "@/lib/robinhood-chain/quiver-launch";
import type { PreparedRobinhoodLaunchTx, RobinhoodLaunchFormFields } from "@/lib/robinhood-chain/types";
import {
  validateRobinhoodLaunchForm,
  normalizeRobinhoodOptional,
  ROBINHOOD_LAUNCH_FIELD_LIMITS,
} from "@/lib/robinhood-chain/launch-form-validation";
import { resolveRobinhoodFeeSplitPlan } from "@/lib/robinhood-chain/fee-splitter.server";
import { buildRobinhoodLaunchDescription } from "@/lib/agent-launch/metadata-branding";
const PREP_TTL_MS = 30 * 60 * 1000;
const { tokenNameMax: TOKEN_NAME_MAX, tokenSymbolMax: TOKEN_SYMBOL_MAX, descriptionMax: DESCRIPTION_MAX } =
  ROBINHOOD_LAUNCH_FIELD_LIMITS;
export { validateRobinhoodLaunchForm } from "@/lib/robinhood-chain/launch-form-validation";
/** Quiver V3 has no separate factory launch fee — tx value is optional initial buy (0 for MVP). */
export async function getRobinhoodFactoryLaunchFee(): Promise<{
  chainId: number;
  launchFeeWei: string;
  launchFeeEth: string;
}> {
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    launchFeeWei: "0",
    launchFeeEth: "0",
  };
}
async function assertFactoryReady(): Promise<void> {
  const client = createRobinhoodPublicClient();
  const deprecated = await client.readContract({
    address: ROBINHOOD_CHAIN_CONFIG.launchFactory,
    abi: quiverFactoryV3Abi,
    functionName: "deprecated",
  });
  if (deprecated) {
    throw new Error("Robinhood Chain launches are temporarily disabled.");
  }
}
/** Encode a user-signed Quiver V3 `deployToken` transaction. */
export async function prepareRobinhoodLaunchTransaction(
  fields: RobinhoodLaunchFormFields,
  options?: { skipLogoPin?: boolean },
): Promise<
  PreparedRobinhoodLaunchTx & {
    preparationId: string;
    logo: {
      originalUrl: string;
      ipfsCid: string;
      ipfsUri: string;
      gatewayUrl: string;
      mimeType: string;
      sizeBytes: number;
      width: number;
      height: number;
    };
  }
> {
  const validationError = validateRobinhoodLaunchForm(fields);
  if (validationError) throw new Error(validationError);
  const sourceImageUrl = fields.tokenImageUrl.trim();
  const logo = options?.skipLogoPin
    ? {
        originalUrl: sourceImageUrl,
        ipfsCid: "",
        ipfsUri: "",
        gatewayUrl: sourceImageUrl,
        mimeType: "image/unknown",
        sizeBytes: 0,
        width: 0,
        height: 0,
      }
    : await prepareRobinhoodTokenLogo({
        sourceUrl: sourceImageUrl,
        agentId: fields.agentDbId,
        tokenName: fields.tokenName,
        tokenSymbol: fields.tokenSymbol,
      });
  await assertFactoryReady();
  const client = createRobinhoodPublicClient();
  const factory = ROBINHOOD_CHAIN_CONFIG.launchFactory;
  const creatorWallet = getAddress(fields.creatorWallet);
  // Optional initial buy reserved for later; MVP value is gas only.
  const value = BigInt(0);
  const launchConfigId = 0;
  const dexId = 0;
  const feeSplit = await resolveRobinhoodFeeSplitPlan(creatorWallet);
  if (!feeSplit.enabled || !feeSplit.splitter) {
    throw new Error(
      "Robinhood fee splitter factory is not configured. Set ROBINHOOD_FEE_SPLITTER_FACTORY after deploying the factory.",
    );
  }
  const onChainLogo = logo.ipfsUri.trim();
  if (!options?.skipLogoPin) {
    if (!onChainLogo.startsWith("ipfs://")) {
      throw new Error(
        "Launch blocked: on-chain logo must be an ipfs:// URI. Re-upload the logo and try again.",
      );
    }
  }
  const onChainDescription = buildRobinhoodLaunchDescription({
    userDescription: fields.tokenDescription,
  });
  const deployArgs = buildQuiverV3DeployArgs({
    name: fields.tokenName.trim(),
    symbol: fields.tokenSymbol.trim(),
    creator: creatorWallet,
    creatorRecipient: getAddress(feeSplit.splitter),
    image: onChainLogo || logo.gatewayUrl,
    description: onChainDescription,
    twitter: normalizeRobinhoodOptional(fields.twitter) ?? "",
    telegram: normalizeRobinhoodOptional(fields.telegram) ?? "",
    website: normalizeRobinhoodOptional(fields.website) ?? "",
    discord: normalizeRobinhoodOptional(fields.discord) ?? "",
    farcaster: normalizeRobinhoodOptional(fields.farcaster) ?? "",
  });
  const data = encodeFunctionData({
    abi: quiverFactoryV3Abi,
    functionName: "deployToken",
    args: deployArgs,
  });
  let gasSuggestion: bigint | undefined;
  try {
    const estimate = await client.estimateGas({
      account: creatorWallet,
      to: factory,
      data,
      value,
    });
    gasSuggestion = (estimate * BigInt(120)) / BigInt(100);
  } catch (err) {
    const msg = Error.isError(err) ? err.message.toLowerCase() : "";
    if (msg.includes("insufficient funds") || msg.includes("insufficient balance")) {
      throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.INSUFFICIENT_ETH);
    }
    gasSuggestion = BigInt(8_000_000);
  }
  const balance = await client.getBalance({ address: creatorWallet });
  if (balance < value) {
    throw new RobinhoodLaunchError(ROBINHOOD_LAUNCH_ERROR.INSUFFICIENT_ETH);
  }
  const preparation = options?.skipLogoPin
    ? null
    : await prisma.robinhoodLaunchPreparation.create({
        data: {
          agentDbId: fields.agentDbId ?? null,
          creatorWallet: creatorWallet.toLowerCase(),
          tokenName: fields.tokenName.trim(),
          tokenSymbol: fields.tokenSymbol.trim(),
          tokenDescription: normalizeRobinhoodOptional(onChainDescription),
          tokenImageOriginalUrl: logo.originalUrl,
          tokenLogoIpfsCid: logo.ipfsCid,
          tokenLogoIpfsUri: logo.ipfsUri,
          tokenLogoGatewayUrl: logo.gatewayUrl,
          logoMimeType: logo.mimeType,
          logoSizeBytes: logo.sizeBytes,
          logoWidth: logo.width,
          logoHeight: logo.height,
          website: normalizeRobinhoodOptional(fields.website),
          twitter: normalizeRobinhoodOptional(fields.twitter),
          telegram: normalizeRobinhoodOptional(fields.telegram),
          discord: normalizeRobinhoodOptional(fields.discord),
          farcaster: normalizeRobinhoodOptional(fields.farcaster),
          preparedTo: factory,
          preparedData: data,
          preparedValue: value.toString(),
          launchConfigId,
          dexId,
          expiresAt: new Date(Date.now() + PREP_TTL_MS),
        },
      });
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    to: factory,
    data,
    value: value.toString(),
    signerWallet: creatorWallet,
    launchConfigId,
    dexId,
    launchFeeWei: "0",
    launchFeeEth: "0",
    gasSuggestion: gasSuggestion?.toString(),
    preparationId: preparation?.id ?? "",
    logo,
  };
}
/** Estimate gas for a Quiver V3 token launch using worst-case placeholder metadata. */
export async function getEstimatedGasForLaunch(): Promise<{
  estimatedGasUnits: string;
  estimatedGasCostWei: string;
  estimatedGasCostEth: string;
}> {
  const client = createRobinhoodPublicClient();
  const factory = ROBINHOOD_CHAIN_CONFIG.launchFactory;
  const deployArgs = buildQuiverV3DeployArgs({
    name: "A".repeat(TOKEN_NAME_MAX),
    symbol: "A".repeat(TOKEN_SYMBOL_MAX),
    creator: "0x0000000000000000000000000000000000000001",
    image: "ipfs://QmPlaceholder",
    description: "A".repeat(DESCRIPTION_MAX),
  });
  const data = encodeFunctionData({
    abi: quiverFactoryV3Abi,
    functionName: "deployToken",
    args: deployArgs,
  });
  let gasEstimate: bigint;
  try {
    gasEstimate = await client.estimateGas({
      account: "0x0000000000000000000000000000000000000001",
      to: factory,
      data,
      value: BigInt(0),
    });
  } catch {
    gasEstimate = BigInt(8_000_000);
  }
  let gasPrice: bigint;
  try {
    gasPrice = await client.getGasPrice();
  } catch {
    gasPrice = BigInt(20_000_000_000);
  }
  const gasCostWei = gasEstimate * gasPrice;
  return {
    estimatedGasUnits: gasEstimate.toString(),
    estimatedGasCostWei: gasCostWei.toString(),
    estimatedGasCostEth: formatEther(gasCostWei),
  };
}
