import { getAddress, isAddress } from "viem";
import { CHAINS } from "@/lib/chains";
import { SOLANA_CHAIN_ID } from "@/lib/chain-constants";
export type RiskLevel = "low" | "med" | "high";
export type SafetyPreflightInput = {
  chainId: number;
  to: string;
  from?: string;
  value?: string;
  data?: string;
};
export type SafetyPreflightResult = {
  riskLevel: RiskLevel;
  reasons: string[];
  checks: Record<string, boolean | string | number>;
};
const ZERO = "0x0000000000000000000000000000000000000000";
function parseWei(value: unknown): bigint | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (s.startsWith("0x")) {
    try {
      return BigInt(s);
    } catch {
      return null;
    }
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  try {
    return BigInt(Math.round(n * 1e18));
  } catch {
    return null;
  }
}
function isSolanaLikeAddress(addr: string): boolean {
  const t = addr.trim();
  if (t.length < 32 || t.length > 48) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(t);
}
function finalize(
  riskLevel: RiskLevel,
  reasons: string[],
  checks: Record<string, boolean | string | number>,
): SafetyPreflightResult {
  const uniq = Array.from(new Set(reasons.filter(Boolean)));
  return { riskLevel, reasons: uniq, checks };
}
/**
 * Static heuristics only — not a substitute for wallet simulation or contract audits.
 */
export function runSafetyPreflight(input: SafetyPreflightInput): SafetyPreflightResult {
  const reasons: string[] = [];
  const checks: Record<string, boolean | string | number> = {};
  const chainKnown = CHAINS.some((c) => c.chainId === input.chainId);
  checks.chainKnown = chainKnown;
  if (!chainKnown) {
    reasons.push("Chain ID is not in the AgentRanking allowlist — confirm you are on the intended network.");
  }
  if (input.chainId === SOLANA_CHAIN_ID) {
    const to = (input.to || "").trim();
    const from = (input.from || "").trim();
    checks.solana = true;
    if (!to) {
      reasons.push("Missing recipient address.");
      return finalize("high", reasons, checks);
    }
    if (!isSolanaLikeAddress(to)) {
      reasons.push("Recipient does not look like a valid Solana address.");
      return finalize("high", reasons, checks);
    }
    if (from && from === to) {
      reasons.push("Sender and recipient are identical.");
      checks.sameToFrom = true;
      return finalize("high", reasons, checks);
    }
    const level: RiskLevel = reasons.length > 0 ? "med" : "low";
    return finalize(level, reasons, checks);
  }
  const toRaw = (input.to || "").trim();
  if (!toRaw) {
    reasons.push("Missing recipient (to) address.");
    return finalize("high", reasons, checks);
  }
  if (!isAddress(toRaw)) {
    reasons.push("Recipient is not a valid 0x-prefixed EVM address.");
    return finalize("high", reasons, checks);
  }
  let checksummed: string;
  try {
    checksummed = getAddress(toRaw);
  } catch {
    reasons.push("Could not normalize recipient address.");
    return finalize("high", reasons, checks);
  }
  checks.checksummedTo = checksummed;
  if (toRaw !== checksummed && /[a-f]/.test(toRaw) && /[A-F]/.test(toRaw)) {
    reasons.push("Recipient uses mixed-case hex but is not EIP-55 checksummed — prefer the checksummed address.");
    checks.nonChecksummed = true;
  }
  if (checksummed.toLowerCase() === ZERO) {
    reasons.push("Recipient is the zero address — this is almost always a mistake or attack.");
    checks.zeroAddress = true;
    return finalize("high", reasons, checks);
  }
  const fromRaw = (input.from || "").trim();
  if (fromRaw && isAddress(fromRaw)) {
    try {
      const fa = getAddress(fromRaw);
      if (fa === checksummed) {
        reasons.push("Sender and recipient are the same wallet.");
        checks.sameToFrom = true;
        return finalize("high", reasons, checks);
      }
    } catch {
      reasons.push("Could not parse sender (from) address.");
    }
  }
  const dataRaw = ((input.data ?? "0x") as string).trim() || "0x";
  const calldata = dataRaw.toLowerCase() === "0x" ? "" : dataRaw;
  checks.calldataBytes = calldata.length > 2 ? Math.floor((calldata.length - 2) / 2) : 0;
  if (calldata.length > 2) {
    const body = calldata.slice(2);
    if (body.length % 2 === 1) {
      reasons.push("Calldata has odd length after 0x — malformed hex.");
      checks.hexOddLength = true;
    }
    if (!/^[0-9a-fA-F]*$/.test(body)) {
      reasons.push("Calldata contains invalid hexadecimal characters.");
      checks.hexInvalid = true;
      return finalize("high", reasons, checks);
    }
  }
  if (calldata.length > 20_000) {
    reasons.push("Calldata is unusually large — verify you are calling the contract you expect.");
    checks.oversizedCalldata = true;
  }
  if (calldata.length >= 10) {
    const selector = calldata.slice(0, 10).toLowerCase();
    checks.selector = selector;
    if (selector === "0x095ea7b3" && calldata.length >= 138) {
      const tail = calldata.slice(-64);
      if (/^f{64}$/.test(tail)) {
        reasons.push("ERC-20 approve appears to use the maximum uint256 allowance — double-check spender trust.");
        checks.unlimitedApprove = true;
      }
    }
    if (selector === "0xa9059cbb") {
      checks.erc20TransferSelector = true;
      const weiVal = parseWei(input.value);
      if (weiVal !== null && weiVal > BigInt(0)) {
        reasons.push("Calldata looks like ERC-20 transfer() but a non-zero native value is also set — verify you are not double-paying.");
        checks.nativeValueWithTokenTransfer = true;
      }
    }
  }
  const wei = parseWei(input.value);
  if (wei !== null) checks.valueWei = wei.toString();
  const emptyCalldata = !calldata || calldata === "0x";
  const weiPerEth = BigInt(10) ** BigInt(18);
  const largeNativeWei = BigInt(500) * weiPerEth;
  if (wei !== null && wei > largeNativeWei && emptyCalldata) {
    reasons.push("Native transfer value is very large with empty calldata — confirm amount and recipient.");
    checks.largeNativeTransfer = true;
  }
  let level: RiskLevel = "low";
  if (checks.zeroAddress || checks.sameToFrom || checks.hexInvalid) level = "high";
  else if (
    reasons.length > 0 ||
    checks.unlimitedApprove ||
    checks.oversizedCalldata ||
    checks.largeNativeTransfer ||
    checks.nonChecksummed ||
    checks.hexOddLength ||
    checks.nativeValueWithTokenTransfer
  ) {
    level = "med";
  }
  return finalize(level, reasons, checks);
}