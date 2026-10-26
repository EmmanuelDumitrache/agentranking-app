import { NextRequest, NextResponse } from "next/server";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonObject,
} from "@/lib/bounded-http-body";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import {
  assertPublicMetaplexLaunchEnabled,
  preparePublicMetaplexQuickLaunch,
  PublicMetaplexPreparationInputError,
  PublicMetaplexPreparationStateError,
  requirePublicMetaplexSolanaSession,
} from "@/lib/public-launch/metaplex-quick-launch.server";
import {
  ValkeyLeaseBusyError,
  ValkeyLeaseLostError,
} from "@/lib/valkey";
export const dynamic = "force-dynamic";
const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
function jsonNoStore(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: NO_STORE_HEADERS });
}
async function enforceRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) limited.headers.set("Cache-Control", "no-store");
  return limited;
}
function bodyString(
  body: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined | null {
  const value = body[key];
  if (value === undefined) return undefined;
  return typeof value === "string" && value.length <= maxLength ? value : null;
}
function invalidBodyResponse(error: unknown): NextResponse | null {
  if (error instanceof HttpBodyTooLargeError) {
    return jsonNoStore({ error: "Request body is too large." }, { status: 413 });
  }
  if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
    return jsonNoStore({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  return null;
}
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request);
  if (limited) return limited;
  const enabled = assertPublicMetaplexLaunchEnabled();
  if (!enabled.ok) return jsonNoStore({ error: enabled.error }, { status: enabled.status });
  const session = await requirePublicMetaplexSolanaSession();
  if (!session.ok) return jsonNoStore({ error: session.error }, { status: session.status });
  let body: Record<string, unknown>;
  try {
    body = await readBoundedJsonObject(request, 32 * 1024);
  } catch (error) {
    const response = invalidBodyResponse(error);
    if (response) return response;
    throw error;
  }
  const tokenName = bodyString(body, "tokenName", 128);
  const tokenSymbol = bodyString(body, "tokenSymbol", 64);
  const tokenDescription = bodyString(body, "tokenDescription", 4_000);
  const tokenImageUrl = bodyString(body, "tokenImageUrl", 2_048);
  const website = bodyString(body, "website", 2_048);
  const twitter = bodyString(body, "twitter", 512);
  const telegram = bodyString(body, "telegram", 512);
  const firstBuySol = bodyString(body, "firstBuySol", 64);
  if ([tokenName, tokenSymbol, tokenDescription, tokenImageUrl, website, twitter, telegram, firstBuySol].includes(null)) {
    return jsonNoStore({ error: "Launch fields must be strings within their allowed limits." }, { status: 400 });
  }
  try {
    const prepared = await preparePublicMetaplexQuickLaunch({
      creatorWallet: session.creatorWallet,
      fields: {
        tokenName: tokenName ?? "",
        tokenSymbol: tokenSymbol ?? "",
        tokenDescription: tokenDescription ?? "",
        tokenImageUrl: tokenImageUrl ?? "",
        website: website ?? undefined,
        twitter: twitter ?? undefined,
        telegram: telegram ?? undefined,
        firstBuySol: firstBuySol ?? undefined,
      },
    });
    return jsonNoStore({ ok: true, ...prepared });
  } catch (error) {
    if (error instanceof PublicMetaplexPreparationInputError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    if (error instanceof PublicMetaplexPreparationStateError) {
      return jsonNoStore({ error: error.message }, { status: 409 });
    }
    if (error instanceof ValkeyLeaseBusyError) {
      return jsonNoStore(
        { error: "A launch preparation is already in progress for this wallet." },
        { status: 409 },
      );
    }
    if (error instanceof ValkeyLeaseLostError) {
      console.error("[public-launch/metaplex/prepare] coordination unavailable", error);
      return jsonNoStore(
        { error: "Launch preparation is temporarily unavailable. Try again shortly." },
        { status: 503 },
      );
    }
    console.error("[public-launch/metaplex/prepare]", error);
    return jsonNoStore(
      { error: "Could not prepare the Metaplex launch." },
      { status: 500 },
    );
  }
}
