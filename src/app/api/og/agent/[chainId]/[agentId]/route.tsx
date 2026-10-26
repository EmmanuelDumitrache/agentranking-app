/* eslint-disable @next/next/no-img-element -- ImageResponse requires plain img elements. */
import { ImageResponse } from "next/og";
import { getAgentSeoData } from "@/lib/agents";
import {
  SOCIAL_OG_HEIGHT,
  SOCIAL_OG_WIDTH,
  loadSocialOgImageDataUrl,
  loadSocialOgMarkDataUrl,
  socialOgInitial,
  socialOgTitleSize,
} from "@/lib/social-og-render";
import { parsePublicAgentId, parsePublicChainId } from "@/lib/agent-public-identity";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const { chainId, agentId } = await params;
  const chainIdNumber = parsePublicChainId(chainId);
  const agentIdNumber = parsePublicAgentId(agentId);
  if (chainIdNumber == null || agentIdNumber == null) {
    return new Response("Agent not found", { status: 404 });
  }
  const agent = await getAgentSeoData(chainIdNumber, agentIdNumber);
  if (!agent) {
    return new Response("Agent not found", { status: 404 });
  }
  const [markDataUrl, agentImageDataUrl] = await Promise.all([
    loadSocialOgMarkDataUrl(),
    loadSocialOgImageDataUrl(agent.image),
  ]);
  const titleSize = socialOgTitleSize(agent.name);
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
            {agentImageDataUrl ? (
              <img
                alt=""
                src={agentImageDataUrl}
                width={240}
                height={240}
                style={{ objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 104, fontWeight: 700, color: "rgba(255,255,255,.7)" }}>
                {socialOgInitial(agent.name)}
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
              {agent.name}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 20,
                color: "rgba(255,255,255,.55)",
                fontSize: 28,
              }}
            >
              {agent.chain.name}
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
