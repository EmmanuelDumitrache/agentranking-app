/* eslint-disable @next/next/no-img-element -- ImageResponse requires plain img elements. */
import { ImageResponse } from "next/og";
import { prisma } from "@/lib/db";
import { getOfficialPublicToken } from "@/lib/public-site/official-tokens";
import {
  SOCIAL_OG_HEIGHT,
  SOCIAL_OG_WIDTH,
  loadSocialOgImageDataUrl,
  loadSocialOgMarkDataUrl,
  socialOgInitial,
  socialOgTitleSize,
} from "@/lib/social-og-render";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> },
) {
  const { mint } = await params;
  const official = getOfficialPublicToken(mint);
  let name = "";
  let subtitle = "";
  let imageUrl: string | null = null;
  if (official) {
    name = official.name;
    subtitle = `$${official.symbol}`;
    imageUrl = official.imageUrl;
  } else {
    const launch = await prisma.agentLaunch.findUnique({
      where: { mint },
      select: {
        tokenName: true,
        tokenSymbol: true,
        tokenImageUrl: true,
        profileDisplayName: true,
        profileAvatarUrl: true,
      },
    });
    if (!launch) {
      return new Response("Token not found", { status: 404 });
    }
    name = launch.profileDisplayName || launch.tokenName || `Token ${mint.slice(0, 8)}…`;
    subtitle = launch.tokenSymbol ? `$${launch.tokenSymbol}` : "Solana token";
    imageUrl = launch.tokenImageUrl || launch.profileAvatarUrl || null;
  }
  const [markDataUrl, tokenImageDataUrl] = await Promise.all([
    loadSocialOgMarkDataUrl(),
    loadSocialOgImageDataUrl(imageUrl),
  ]);
  const titleSize = socialOgTitleSize(name);
  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#000",
          color: "#fafafa",
          fontFamily: "Arial, Helvetica, sans-serif",
          padding: "72px 88px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", height: 72 }}>
          {markDataUrl ? (
            <img
              alt=""
              src={markDataUrl}
              width={64}
              height={64}
              style={{ objectFit: "contain" }}
            />
          ) : null}
          <div
            style={{
              display: "flex",
              marginLeft: markDataUrl ? 18 : 0,
              fontSize: 38,
              letterSpacing: -0.5,
            }}
          >
            <span style={{ fontWeight: 700 }}>Agent</span>
            <span style={{ fontWeight: 400 }}>Ranking</span>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flex: 1,
            gap: 48,
            marginTop: 28,
          }}
        >
          <div
            style={{
              width: 240,
              height: 240,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
              borderRadius: 48,
              background: "rgba(255,255,255,.06)",
            }}
          >
            {tokenImageDataUrl ? (
              <img
                alt=""
                src={tokenImageDataUrl}
                width={240}
                height={240}
                style={{ objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 104, fontWeight: 700, color: "rgba(255,255,255,.7)" }}>
                {socialOgInitial(name)}
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, maxWidth: 700 }}>
            <div
              style={{
                display: "flex",
                fontSize: titleSize,
                lineHeight: 1.05,
                letterSpacing: -2.5,
                fontWeight: 700,
              }}
            >
              {name}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 20,
                color: "rgba(255,255,255,.55)",
                fontSize: 28,
              }}
            >
              {subtitle}
            </div>
          </div>
        </div>
      </div>
    ),
    { width: SOCIAL_OG_WIDTH, height: SOCIAL_OG_HEIGHT },
  );
  response.headers.set(
    "Cache-Control",
    "public, s-maxage=300, stale-while-revalidate=86400",
  );
  return response;
}
