import { NextRequest, NextResponse } from "next/server";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";
import {
  createLaunchWalletNonce,
} from "@/lib/launch-wallet-session/nonce-store";
import { rateLimitLaunchWalletNonce } from "@/lib/launch-wallet-session/rate-limit";
import { normalizeLaunchWallet } from "@/lib/launch-wallet-session/wallet-match";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function parseChain(raw: unknown): LaunchWalletChain | null {
  return raw === "solana" || raw === "evm" ? raw : null;
}
export async function POST(request: NextRequest) {
  const limited = await rateLimitLaunchWalletNonce(request);
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonObject(request, 2 * 1024);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ error: "Request body is too large." }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return jsonNoStore({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    throw error;
  }
  const chain = parseChain(body.chain);
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  if (!chain) return jsonNoStore({ error: "chain must be solana or evm" }, { status: 400 });
  if (wallet.length > 128 || !normalizeLaunchWallet(chain, wallet)) {
    return jsonNoStore({ error: "Invalid wallet address" }, { status: 400 });
  }
  try {
    const challenge = await createLaunchWalletNonce({ chain, wallet });
    return jsonNoStore({ ok: true, ...challenge, chain });
  } catch (error) {
    console.error("[launch-wallet/nonce] challenge creation failed", error);
    return jsonNoStore({ error: "Could not create the wallet challenge." }, { status: 500 });
  }
}
