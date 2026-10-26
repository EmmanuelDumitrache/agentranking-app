import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import {
  HttpBodyTooLargeError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { isAddress } from "viem";
import { parseRobinhoodImportMetadata } from "@/lib/robinhood-chain/http-input";
import { importRobinhoodLaunch } from "@/lib/robinhood-chain/record-launch.server";

export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const TRANSACTION_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

function json(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await readBoundedJsonObject(request, 16 * 1024);
    const tokenAddress = typeof body.tokenAddress === "string" ? body.tokenAddress.trim() : undefined;
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : undefined;
    if (txHash && !TRANSACTION_HASH_RE.test(txHash)) {
      return json({ error: "Invalid txHash" }, { status: 400 });
    }
    if (tokenAddress && !isAddress(tokenAddress)) {
      return json({ error: "Invalid tokenAddress" }, { status: 400 });
    }
    if (!txHash && !tokenAddress) {
      return json({ error: "tokenAddress or txHash is required" }, { status: 400 });
    }
    const launch = await importRobinhoodLaunch({
      tokenAddress,
      txHash,
      form: parseRobinhoodImportMetadata(body),
    });
    return json({ ok: true, launch });
  } catch (error) {
    const status = error instanceof HttpBodyTooLargeError ? 413 : 400;
    const message =
      error instanceof InvalidJsonBodyError || error instanceof HttpBodyTooLargeError || Error.isError(error)
        ? error.message
        : "Could not import launch";
    return json({ error: message }, { status });
  }
}
