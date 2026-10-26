/** Renders the gold verified marketing card as a 1200×675 PNG. */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
const W = 1200;
const H = 675;
const AMBER = "#fbbf24";
const AMBER_DIM = "#f59e0b";
const AMBER_LIGHT = "#fcd34d";
type SharpCompositeOptions = Parameters<ReturnType<typeof sharp>["composite"]>[0];
function escapeXml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function normalizeAgentDisplayName(raw: string) {
  const s = String(raw || "")
    .replace(/^@+/, "")
    .trim();
  return s || "Agent";
}
function svgVerified(agentNameRaw: string) {
  const display = escapeXml(normalizeAgentDisplayName(agentNameRaw));
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="barA" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${AMBER}"/>
      <stop offset="55%" stop-color="${AMBER_DIM}"/>
      <stop offset="100%" stop-color="${AMBER_DIM}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="glowA" cx="50%" cy="33%" r="55%">
      <stop offset="0%" stop-color="rgba(251,191,36,0.12)"/>
      <stop offset="100%" stop-color="rgba(251,191,36,0)"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="#11131f"/>
  <rect width="${W}" height="${H}" fill="url(#glowA)"/>
  <rect x="0" y="0" width="${W}" height="4" fill="url(#barA)"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="rgba(245,158,11,0.35)" stroke-width="1.5"/>
  <text x="600" y="316" fill="${AMBER_LIGHT}" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="20" font-weight="600" text-anchor="middle" letter-spacing="2">Now Verified</text>
  <text x="600" y="398" fill="${AMBER}" font-family="system-ui,-apple-system,BlinkMacSystemFont,sans-serif" font-size="52" font-weight="700" text-anchor="middle">${display}</text>
  <rect x="0" y="${H - 68}" width="${W}" height="68" fill="rgba(251,191,36,0.08)"/>
  <text x="60" y="${H - 28}" fill="#6b7280" font-family="system-ui,sans-serif" font-size="15" font-weight="600">Discover  ·  Verify  ·  Rank</text>
  <text x="1140" y="${H - 28}" fill="${AMBER}" font-family="system-ui,sans-serif" font-size="18" font-weight="700" text-anchor="end">agentranking.io</text>
</svg>`;
}
async function compositeBrandTopLeft(
  basePng: Buffer,
  logoPath: string,
  badgePath: string,
  { includeBadge = false }: { includeBadge?: boolean } = {}
) {
  if (!fs.existsSync(logoPath)) {
    throw new Error(`Missing brand logo: ${logoPath}`);
  }
  const composites: SharpCompositeOptions = [];
  const brandBuf = await sharp(logoPath)
    .resize({ height: 52, fit: "inside" })
    .ensureAlpha()
    .png()
    .toBuffer();
  composites.push({ input: brandBuf, left: 48, top: 44 });
  if (includeBadge && fs.existsSync(badgePath)) {
    const badgeBuf = await sharp(badgePath)
      .resize({ height: 88, fit: "inside" })
      .ensureAlpha()
      .png()
      .toBuffer();
    const meta = await sharp(badgeBuf).metadata();
    const bw = meta.width || 88;
    composites.push({ input: badgeBuf, left: Math.round((W - bw) / 2), top: 200 });
  }
  return sharp(basePng).composite(composites).png().toBuffer();
}
/**
 * @param displayName Agent display name for the card (leading @ stripped).
 */
export async function renderVerifiedCardPng(displayName: string): Promise<Buffer> {
  const root = process.cwd();
  const logoPath = path.join(root, "brandkit", "logo.png");
  const badgePath = path.join(root, "brandkit", "verified-badge.svg");
  const svg = svgVerified(displayName);
  const base = await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
  return compositeBrandTopLeft(base, logoPath, badgePath, { includeBadge: true });
}
