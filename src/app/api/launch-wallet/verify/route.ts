import { NextRequest, NextResponse } from "next/server";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import type { LaunchWalletChain } from "@/lib/launch-wallet-session/constants";
import {
  consumeLaunchWalletNonce,
} from "@/lib/launch-wallet-session/nonce-store";
import { rateLimitLaunchWalletVerify } from "@/lib/launch-wallet-session/rate-limit";
import { createLaunchWalletSession } from "@/lib/launch-wallet-session/session";
import { verifyLaunchWalletSignature } from "@/lib/launch-wallet-session/verify";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
function parseChain(raw: unknown): LaunchWalletChain | null {
  return raw === "solana" || raw === "evm" ? raw : null;
}
export async function POST(request: NextRequest) {
  const limited = await rateLimitLaunchWalletVerify(request);
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonObject(request, 8 * 1024);
  } catch (error) {
    if (error instanceof HttpBodyTooLargeError) {
      return jsonNoStore({ error: "Request body is too large." }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return jsonNoStore({ error: "Request body must be valid JSON." }, { status: 400 });
    }
    throw error;
  }
  const challengeId = typeof body.challengeId === "string" ? body.challengeId.trim() : "";
  const chain = parseChain(body.chain);
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  if (
    !/^[a-f0-9]{32}$/.test(challengeId) ||
    !chain ||
    !wallet || wallet.length > 128 ||
    !message || message.length > 2_048 ||
    !signature || signature.length > 1_024
  ) {
    return jsonNoStore({ error: "Invalid or missing verification fields" }, { status: 400 });
  }
  const verified = await verifyLaunchWalletSignature({ chain, wallet, message, signature });
  if (!verified.ok) return jsonNoStore({ error: verified.error }, { status: 400 });
  const consumed = await consumeLaunchWalletNonce({
    id: challengeId,
    chain,
    wallet: verified.wallet,
    nonce: verified.nonce,
    message,
  });
  if (!consumed.ok) return jsonNoStore({ error: consumed.error }, { status: 400 });
  try {
    const session = await createLaunchWalletSession({
      wallet: verified.wallet,
      chain,
      challengeId,
    });
    return jsonNoStore({
      ok: true,
      wallet: session.wallet,
      chain: session.chain,
      expiresAt: new Date(session.expiresAt).toISOString(),
    });
  } catch (error) {
    console.error("[launch-wallet/verify] session creation failed", error);
    return jsonNoStore({ error: "Could not create the wallet session." }, { status: 500 });
  }
}
