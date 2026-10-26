import type { ArTokenSettingsView } from "@/lib/ar-token-metrics";
/** Rough Solana pubkey / common placeholder sizes */
const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
/** Signatures or long reference strings admins may paste */
const SOLANA_REF_RE = /^[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const EVM_TX_RE = /^0x[a-fA-F0-9]{64}$/;
function parseNonNegativeAmount(token: string): { ok: true; value: number } | { ok: false; error: string } {
  const normalized = token.replaceAll(",", "").trim();
  if (normalized === "") return { ok: true, value: 0 };
  const n = Number.parseFloat(normalized);
  if (!Number.isFinite(n)) return { ok: false, error: "amountToken must be a valid number" };
  if (n < 0) return { ok: false, error: "amountToken cannot be negative" };
  return { ok: true, value: n };
}
export type MetricEventInput = {
  eventType: string;
  amountToken: string;
  amountUsd: string;
  wallet: string;
  txHash: string;
  note: string;
};
/**
 * Server-side validation before persisting ArTokenMetricEvent rows.
 * Wallet / tx rules follow ArTokenSettings.tokenLedger when set.
 */
export function validateMetricEventInput(
  settings: ArTokenSettingsView | null,
  input: MetricEventInput,
): { ok: true } | { ok: false; error: string } {
  const ledger = settings?.tokenLedger === "solana" ? "solana" : "evm";
  const amt = parseNonNegativeAmount(input.amountToken);
  if (!amt.ok) return amt;
  const usdRaw = input.amountUsd.replaceAll(",", "").trim();
  if (usdRaw !== "") {
    const u = Number.parseFloat(usdRaw);
    if (!Number.isFinite(u)) return { ok: false, error: "amountUsd must be a valid number if provided" };
    if (u < 0) return { ok: false, error: "amountUsd cannot be negative" };
  }
  const wallet = input.wallet.trim();
  if (wallet) {
    if (ledger === "solana") {
      if (!SOLANA_BASE58_RE.test(wallet)) {
        return { ok: false, error: "wallet does not look like a Solana address (base58, 32–44 chars)" };
      }
    } else if (!EVM_ADDR_RE.test(wallet)) {
      return { ok: false, error: "wallet does not look like an EVM address (0x + 40 hex)" };
    }
  }
  const tx = input.txHash.trim();
  if (tx) {
    if (ledger === "solana") {
      if (!SOLANA_REF_RE.test(tx)) {
        return { ok: false, error: "txHash must be base58 (Solana signature or reference), 32–128 chars" };
      }
    } else if (!EVM_TX_RE.test(tx) && !EVM_ADDR_RE.test(tx)) {
      return { ok: false, error: "txHash must be a 32-byte EVM tx hash (0x + 64 hex) or leave blank" };
    }
  }
  const stakingTypes = new Set(["staking_deposit", "staking_withdrawal", "staking_reward"]);
  if (stakingTypes.has(input.eventType) && !input.amountToken.trim()) {
    return { ok: false, error: "staking events require amountToken" };
  }
  return { ok: true };
}