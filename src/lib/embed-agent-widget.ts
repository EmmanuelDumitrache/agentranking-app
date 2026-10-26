import { prisma } from "@/lib/db";
import { isAgentBlocked } from "@/lib/agent-blocklist";
import { absoluteUrl, getPublicSiteUrl } from "@/lib/site-url";
import { agentPublicUrl } from "@/lib/agent-public-url";
export type EmbedAgentRecord = {
  id: number;
  name: string;
  description: string | null;
  image: string | null;
  score: number;
  isPremiumVerified: boolean;
  isVerifiedRevenue: boolean;
  chainId: number;
  agentId: number;
  rank: number;
  agentRankScore: number | null;
  executionScore: number | null;
  chain: { name: string; shortName: string; color: string };
  services: { name: string; endpoint: string }[];
  metadata: { key: string; value: string }[];
};
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function safeCssColor(c: string): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : "#888888";
}
function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol === "http:" || u.protocol === "https:") return u.href;
  } catch {
    /* ignore */
  }
  return null;
}
export async function loadAgentForEmbed(agentId: number): Promise<EmbedAgentRecord | null> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      description: true,
      image: true,
      score: true,
      isPremiumVerified: true,
      isVerifiedRevenue: true,
      chainId: true,
      agentId: true,
      agentURI: true,
      owner: true,
      rank: true,
      agentRankScore: true,
      executionScore: true,
      chain: { select: { name: true, shortName: true, color: true } },
      services: { select: { name: true, endpoint: true } },
      metadata: { select: { key: true, value: true } },
    },
  });
  if (!agent) return null;
  if (
    await isAgentBlocked({
      name: agent.name,
      agentURI: agent.agentURI ?? "",
      owner: agent.owner ?? "",
      chainId: agent.chainId,
      agentId: agent.agentId,
    })
  ) {
    return null;
  }
  const { agentURI: _a, owner: _o, ...publicAgent } = agent;
  return publicAgent;
}
function rankLabel(rank: number): string {
  if (!rank || rank <= 0) return "—";
  return `#${rank}`;
}
export function buildEmbedAgentHtmlDocument(agent: EmbedAgentRecord, searchParams: URLSearchParams): string {
  const theme = searchParams.get("theme") === "light" ? "light" : "dark";
  const showProfileScore = searchParams.get("showProfileScore") !== "false";
  const showBadge = searchParams.get("showBadge") !== "false";
  const showSocials = searchParams.get("showSocials") !== "false";
  const showMcp = searchParams.get("showMcp") !== "false";
  const showEndpoints = searchParams.get("showEndpoints") !== "false";
  const showDescription = searchParams.get("showDescription") !== "false";
  const showRank = searchParams.get("showRank") === "true";
  const showAgentIds = searchParams.get("showAgentIds") === "true";
  const showAgentRankScore = searchParams.get("showAgentRankScore") === "true";
  const showExecutionScore = searchParams.get("showExecutionScore") === "true";
  const showPoweredBy = searchParams.get("showPoweredBy") !== "false";
  const variantRaw = searchParams.get("variant") ?? "card";
  const variant = variantRaw === "compact" || variantRaw === "banner" ? variantRaw : "card";
  const size = (searchParams.get("size") ?? "md") as "sm" | "md" | "lg";
  const borderRadiusParam = searchParams.get("borderRadius") ?? "rounded";
  const accentParam = searchParams.get("accentColor") ?? "0052FF";
  const accent = safeCssColor(`#${accentParam.replace(/^#/, "")}`);
  const bg = theme === "dark" ? "#0d0d0f" : "#ffffff";
  const border = theme === "dark" ? "#1e1e24" : "#e5e7eb";
  const text = theme === "dark" ? "#f4f4f5" : "#111111";
  const muted = theme === "dark" ? "#71717a" : "#6b7280";
  const card = theme === "dark" ? "#18181b" : "#f9fafb";
  const chainColor = safeCssColor(agent.chain.color);
  const cardRadius = borderRadiusParam === "sharp" ? "6px" : borderRadiusParam === "pill" ? "24px" : "14px";
  const chipRadius = borderRadiusParam === "sharp" ? "3px" : borderRadiusParam === "pill" ? "999px" : "6px";
  const sizeMap = {
    sm: { pad: "12px", nameSize: "13px", descSize: "11px", imgSize: 32, gap: 8, maxW: 320, minW: 200 },
    md: { pad: "16px", nameSize: "15px", descSize: "12px", imgSize: 42, gap: 10, maxW: 400, minW: 260 },
    lg: { pad: "20px", nameSize: "17px", descSize: "13px", imgSize: 52, gap: 12, maxW: 480, minW: 300 },
  };
  const sBase = sizeMap[size] ?? sizeMap.md;
  const compactScale = variant === "compact" ? 0.88 : 1;
  const s = {
    pad: variant === "compact" ? "10px 12px" : sBase.pad,
    nameSize: variant === "compact" ? "12px" : sBase.nameSize,
    descSize: variant === "compact" ? "10px" : sBase.descSize,
    imgSize: Math.round(sBase.imgSize * compactScale),
    gap: Math.round(sBase.gap * compactScale),
    maxW: sBase.maxW,
    minW: sBase.minW,
  };
  const socials = agent.metadata.filter(
    (m) => ["twitter", "github", "telegram", "website", "discord"].includes(m.key) && m.value.trim(),
  );
  const mcpMeta = agent.metadata.find((m) => m.key === "mcpEndpoint" || m.key === "mcp_endpoint");
  const agentUrl = agentPublicUrl(getPublicSiteUrl(), agent);
  const imgHref = safeHttpUrl(agent.image);
  const initial = escapeHtml(agent.name.slice(0, 1).toUpperCase());
  const avatarHtml = imgHref
    ? `<img src="${escapeHtml(imgHref)}" alt="${escapeHtml(agent.name)}" width="${s.imgSize}" height="${s.imgSize}" style="border-radius:${chipRadius};object-fit:cover;flex-shrink:0;display:block"/>`
    : `<div style="width:${s.imgSize}px;height:${s.imgSize}px;border-radius:${chipRadius};background:${accent}22;display:flex;align-items:center;justify-content:center;font-size:${Math.round(s.imgSize * 0.42)}px;font-weight:800;color:${accent};flex-shrink:0">${initial}</div>`;
  const badgeHtml = showBadge && agent.isPremiumVerified
    ? `<span style="font-size:9px;font-weight:700;background:#f59e0b1a;color:#f59e0b;border:1px solid #f59e0b33;border-radius:${chipRadius};padding:2px 6px;letter-spacing:0.05em">KYA</span>`
    : "";
  const profileScoreHtml = showProfileScore
    ? (() => {
        const pct = Math.round(agent.score);
        const r = 10;
        const circ = 2 * Math.PI * r;
        const dash = (pct / 100) * circ;
        return `<div style="display:flex;align-items:center;gap:5px">
<svg width="28" height="28" viewBox="0 0 28 28">
  <circle cx="14" cy="14" r="${r}" fill="none" stroke="${border}" stroke-width="3"/>
  <circle cx="14" cy="14" r="${r}" fill="none" stroke="${accent}" stroke-width="3" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round" transform="rotate(-90 14 14)"/>
</svg>
<span style="font-size:11px;font-weight:700;color:${text}">${pct}</span>
</div>`;
      })()
    : "";
  const agentRankValue =
    agent.agentRankScore != null && agent.agentRankScore > 0
      ? Math.round(agent.agentRankScore)
      : 0;
  const executionValue = agent.executionScore != null ? Math.round(agent.executionScore) : 0;
  const premiumChips: string[] = [];
  if (showRank) {
    premiumChips.push(
      `<span style="font-size:9px;font-weight:600;background:${card};border:1px solid ${border};border-radius:${chipRadius};padding:2px 6px;color:${muted}">Rank ${escapeHtml(rankLabel(agent.rank))}</span>`,
    );
  }
  if (showAgentIds) {
    premiumChips.push(
      `<span style="font-size:9px;font-weight:600;background:${card};border:1px solid ${border};border-radius:${chipRadius};padding:2px 6px;color:${muted};font-family:monospace">ID ${agent.agentId}</span>`,
    );
  }
  if (showAgentRankScore) {
    premiumChips.push(
      `<span style="font-size:9px;font-weight:700;background:${accent}14;border:1px solid ${accent}44;border-radius:${chipRadius};padding:2px 6px;color:${accent}">AR ${agentRankValue}</span>`,
    );
  }
  if (showExecutionScore) {
    const dim = executionValue <= 0 ? "opacity:0.55" : "";
    premiumChips.push(
      `<span style="font-size:9px;font-weight:700;background:#06b6d414;border:1px solid #06b6d444;border-radius:${chipRadius};padding:2px 6px;color:#22d3ee;${dim}">Execution ${executionValue}</span>`,
    );
  }
  if (agent.isVerifiedRevenue) {
    premiumChips.push(
      `<span style="font-size:9px;font-weight:700;background:#10b9811a;border:1px solid #10b98144;border-radius:${chipRadius};padding:2px 6px;color:#34d399">Verified revenue</span>`,
    );
  }
  const premiumHtml =
    premiumChips.length > 0
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${premiumChips.join("")}</div>`
      : "";
  const descClamp = variant === "compact" ? "1" : "2";
  const descHtml = showDescription && agent.description?.trim()
    ? `<p style="font-size:${s.descSize};color:${muted};line-height:1.55;overflow:hidden;display:-webkit-box;-webkit-line-clamp:${descClamp};-webkit-box-orient:vertical;margin:0">${escapeHtml(agent.description)}</p>`
    : "";
  const endpointsHtml = showEndpoints && agent.services.length > 0
    ? `<div style="display:flex;gap:4px;flex-wrap:wrap">${agent.services
        .slice(0, variant === "compact" ? 2 : 3)
        .map(
          (svc) =>
            `<span style="font-size:10px;background:${card};border:1px solid ${border};border-radius:${chipRadius};padding:2px 7px;color:${muted};font-family:monospace">${escapeHtml(svc.name)}</span>`,
        )
        .join("")}</div>`
    : "";
  const mcpHtml = showMcp && mcpMeta?.value
    ? (() => {
        const mcpUrl = safeHttpUrl(mcpMeta.value);
        if (!mcpUrl) return "";
        return `<div style="font-size:10px;background:${card};border:1px solid ${border};border-radius:${chipRadius};padding:5px 8px;display:flex;align-items:center;gap:5px"><span style="color:${muted};font-weight:600">MCP</span><a href="${escapeHtml(mcpUrl)}" target="_blank" rel="noopener noreferrer" style="color:${accent};font-family:monospace;word-break:break-all;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${escapeHtml(mcpMeta.value)}</a></div>`;
      })()
    : "";
  const socialIcons: Record<string, string> = { twitter: "𝕏", github: "GH", telegram: "TG", website: "🌐", discord: "DC" };
  const socialsHtml = showSocials && socials.length > 0
    ? (() => {
        const links = socials
          .map((soc) => {
            const href = safeHttpUrl(soc.value);
            if (!href) return "";
            return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="font-size:10px;font-weight:700;background:${card};border:1px solid ${border};border-radius:${chipRadius};padding:2px 7px;color:${muted};text-decoration:none">${escapeHtml(socialIcons[soc.key] ?? soc.key.toUpperCase())}</a>`;
          })
          .filter(Boolean)
          .join("");
        return links ? `<div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap">${links}</div>` : "";
      })()
    : "";
  const logoUrl = absoluteUrl("/logo-icon.png");
  const brandingFooter = `<div style="border-top:1px solid ${border};padding-top:10px;margin-top:4px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
  <img src="${escapeHtml(logoUrl)}" width="22" height="22" alt="AgentRanking" style="display:block;border-radius:6px;flex-shrink:0;background:${theme === "dark" ? "#27272a" : "#f4f4f5"};padding:2px" loading="lazy" referrerpolicy="no-referrer" />
  <div style="display:flex;flex-direction:column;gap:2px;flex:1;min-width:0">
    ${showPoweredBy ? `<span style="font-size:9px;color:${muted};line-height:1.3">Powered by <span style="font-weight:700;color:${text}">AgentRanking</span></span>` : ""}
    <a href="${escapeHtml(agentUrl)}" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:${accent};font-weight:600;text-decoration:none;display:inline-block">View profile →</a>
  </div>
</div>`;
  const headerRowStyle =
    variant === "banner"
      ? "display:flex;flex-direction:row;align-items:center;gap:12px;margin-top:4px;flex-wrap:wrap"
      : "display:flex;align-items:flex-start;gap:10px;margin-top:4px";
  const nameBlock = `<div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
        <a href="${escapeHtml(agentUrl)}" target="_blank" rel="noopener noreferrer" style="font-weight:700;font-size:${s.nameSize};color:${text};text-decoration:none;line-height:1.2">${escapeHtml(agent.name)}</a>
        ${badgeHtml}
      </div>
      <div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
        <span style="font-size:10px;font-weight:600;background:${chainColor}1a;color:${chainColor};border:1px solid ${chainColor}33;border-radius:${chipRadius};padding:1px 6px">${escapeHtml(agent.chain.shortName)}</span>
        ${profileScoreHtml}
      </div>
      ${premiumHtml}
    </div>`;
  const mainInner =
    variant === "banner"
      ? `${avatarHtml}${nameBlock}`
      : `${avatarHtml}
    ${nameBlock}`;
  const cardStyle = [
    `margin:0`,
    `background:${bg}`,
    `border:1px solid ${border}`,
    `border-radius:${cardRadius}`,
    `padding:${s.pad}`,
    `display:flex`,
    `flex-direction:column`,
    `gap:${s.gap}px`,
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`,
    `color:${text}`,
    `min-width:${s.minW}px`,
    `max-width:${s.maxW}px`,
    `box-shadow:${variant === "banner" ? "0 2px 8px rgba(0,0,0,0.15)" : "0 1px 3px rgba(0,0,0,0.12),0 1px 2px rgba(0,0,0,0.08)"}`,
    `overflow:hidden`,
    `position:relative`,
  ].join(";");
  const body = `<div class="embed-agent-card" style="${cardStyle}">
  <div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,${accent},${accent}88)"></div>
  <div style="${headerRowStyle}">
    ${mainInner}
  </div>
  ${descHtml}
  ${endpointsHtml}
  ${mcpHtml}
  ${socialsHtml}
  ${brandingFooter}
</div>`;
  const title = escapeHtml(`${agent.name} — AgentRanking`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  *,*::before,*::after{box-sizing:border-box}
  .embed-agent-card a{text-decoration:none;color:inherit}
  .embed-agent-card a:hover{opacity:0.82}
  body{margin:0;padding:0;background:${bg};display:flex;align-items:flex-start;justify-content:flex-start}
</style>
</head>
<body>
${body}
</body>
</html>`;
}
