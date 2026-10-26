/**
 * GET /.well-known/jwks.json
 *
 * Public JWKS endpoint that Privy's servers use to verify the custom JWT
 * signed by our RS256 private key.  Exposes only the public key — never
 * the private key or any secrets.
 */
import { NextResponse } from "next/server";
import { getPublicJwks, getJwtConfig } from "@/lib/jwt-utils.server";
export const dynamic = "force-dynamic";
export async function GET() {
  const cfg = getJwtConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "Public JWKS is not configured" },
      { status: 500 },
    );
  }
  const jwks = await getPublicJwks();
  return NextResponse.json(jwks, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}