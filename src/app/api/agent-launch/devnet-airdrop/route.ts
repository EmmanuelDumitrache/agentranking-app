import { NextRequest, NextResponse } from "next/server";
import {
  assertAgentLaunchDevMockAllowed,
  agentLaunchApiGuardResponse,
} from "@/lib/agent-launch/guards";
import { MAX_DEVNET_AIRDROP_LAMPORTS } from "@/lib/agent-launch/constants-local";
import { getAgentLaunchConnection } from "@/lib/agent-launch/solana";
import { parseSolanaPubkey, validateSolanaPubkey } from "@/lib/agent-launch/validation";
export const dynamic = "force-dynamic";
/**
 * Local/devnet-only convenience airdrop. Public RPC may rate-limit — use official faucet as fallback.
 */
export async function POST(request: NextRequest) {
  const guard = assertAgentLaunchDevMockAllowed();
  if (!guard.ok) return agentLaunchApiGuardResponse(guard);
  try {
    const body = (await request.json()) as {
      wallet?: string;
      lamports?: number | string;
    };
    const walletError = validateSolanaPubkey(body.wallet, "Wallet");
    if (walletError) {
      return NextResponse.json({ error: walletError }, { status: 400 });
    }
    const lamportsRaw = body.lamports ?? MAX_DEVNET_AIRDROP_LAMPORTS;
    const lamports =
      typeof lamportsRaw === "string" ? Number.parseInt(lamportsRaw, 10) : lamportsRaw;
    if (!Number.isFinite(lamports) || lamports <= 0) {
      return NextResponse.json({ error: "lamports must be a positive number" }, { status: 400 });
    }
    if (lamports > MAX_DEVNET_AIRDROP_LAMPORTS) {
      return NextResponse.json(
        { error: `Maximum airdrop is ${MAX_DEVNET_AIRDROP_LAMPORTS} lamports (1 SOL)` },
        { status: 400 },
      );
    }
    const wallet = parseSolanaPubkey(body.wallet!, "Wallet");
    const connection = getAgentLaunchConnection();
    let signature: string;
    try {
      signature = await connection.requestAirdrop(wallet, lamports);
      const latest = await connection.getLatestBlockhash("confirmed");
      await connection.confirmTransaction(
        { signature, ...latest },
        "confirmed",
      );
    } catch (error) {
      const message = Error.isError(error) ? error.message : String(error);
      const rateLimited =
        message.toLowerCase().includes("rate") ||
        message.toLowerCase().includes("429") ||
        message.toLowerCase().includes("airdrop request failed");
      return NextResponse.json(
        {
          error: rateLimited
            ? "Devnet airdrop rate-limited. Use https://faucet.solana.com/ instead."
            : `Airdrop failed: ${message}`,
          code: rateLimited ? "airdrop_rate_limited" : "airdrop_failed",
          faucetUrl: "https://faucet.solana.com/",
        },
        { status: rateLimited ? 429 : 502 },
      );
    }
    const balance = await connection.getBalance(wallet);
    return NextResponse.json({
      signature,
      wallet: wallet.toBase58(),
      lamports,
      balanceLamports: balance.toString(),
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Airdrop failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
