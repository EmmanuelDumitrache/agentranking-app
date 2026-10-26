import "server-only";
import { randomBytes } from "node:crypto";
import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";
import { LAUNCH_WALLET_NONCE_TTL_MS } from "@/lib/launch-wallet-session/constants";
import { buildLaunchWalletSessionMessage } from "@/lib/launch-wallet-session/messages";
import { valkeyEval, valkeySetStringPx } from "@/lib/valkey";

type StoredNonce = {
  id: string;
  chain: LaunchWalletChain;
  wallet: string;
  nonce: string;
  message: string;
  expiresAt: number;
  usedAt: number | null;
};

const CONSUME_NONCE_LUA = `
redis.setresp(3)
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local decoded, row = pcall(cjson.decode, raw)
if not decoded then return {'corrupt'} end
local now = tonumber(ARGV[1])
if row.usedAt ~= nil and row.usedAt ~= cjson.null then return {'used'} end
if tonumber(row.expiresAt) <= now then return {'expired'} end
if row.chain ~= ARGV[2] then return {'chain'} end
if row.wallet ~= ARGV[3] then return {'wallet'} end
if row.nonce ~= ARGV[4] then return {'nonce'} end
if row.message ~= ARGV[5] then return {'message'} end
row.usedAt = now
local ttl = math.max(1, tonumber(row.expiresAt) - now)
redis.call('PSETEX', KEYS[1], ttl, cjson.encode(row))
return {'ok'}
`;

function valkeyKey(id: string): string {
  return `launch-wallet-nonce:${id}`;
}

function normalizeWallet(chain: LaunchWalletChain, wallet: string): string {
  const trimmed = wallet.trim();
  return chain === "evm" ? trimmed.toLowerCase() : trimmed;
}

export async function createLaunchWalletNonce(input: {
  chain: LaunchWalletChain;
  wallet: string;
}): Promise<{ id: string; message: string; expiresAt: string }> {
  const chain = input.chain;
  const wallet = normalizeWallet(chain, input.wallet);
  if (!wallet) throw new Error("Wallet is required.");
  const id = randomBytes(16).toString("hex");
  const nonce = randomBytes(18).toString("base64url");
  const issuedAtIso = new Date().toISOString();
  const message = buildLaunchWalletSessionMessage({ chain, wallet, nonce, issuedAtIso });
  const expiresAt = Date.now() + LAUNCH_WALLET_NONCE_TTL_MS;
  const row: StoredNonce = {
    id,
    chain,
    wallet,
    nonce,
    message,
    expiresAt,
    usedAt: null,
  };
  await valkeySetStringPx(valkeyKey(id), JSON.stringify(row), LAUNCH_WALLET_NONCE_TTL_MS);
  return { id, message, expiresAt: new Date(expiresAt).toISOString() };
}

export async function consumeLaunchWalletNonce(input: {
  id: string;
  chain: LaunchWalletChain;
  wallet: string;
  nonce: string;
  message: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const result = await valkeyEval({
    script: CONSUME_NONCE_LUA,
    keys: [valkeyKey(input.id)],
    args: [
      String(Date.now()),
      input.chain,
      normalizeWallet(input.chain, input.wallet),
      input.nonce.trim(),
      input.message,
    ],
  });
  const code = Array.isArray(result) ? String(result[0] ?? "") : "";
  if (code === "ok") return { ok: true };
  const errors: Record<string, string> = {
    missing: "Challenge expired or not found. Request a new signature.",
    corrupt: "Challenge is invalid. Request a new signature.",
    used: "Challenge already used. Request a new signature.",
    expired: "Challenge expired. Request a new signature.",
    chain: "Challenge chain mismatch.",
    wallet: "Challenge wallet mismatch.",
    nonce: "Challenge nonce mismatch.",
    message: "Challenge message mismatch.",
  };
  return { ok: false, error: errors[code] ?? "Challenge could not be consumed." };
}
