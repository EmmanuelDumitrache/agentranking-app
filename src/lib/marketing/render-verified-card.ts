import "server-only";
import sharp from "sharp";
function escapeXml(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
export async function renderVerifiedCardPng(agentName: string): Promise<Buffer> {
  const name = escapeXml(agentName.trim().replace(/^@+/, "") || "Verified Agent");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#09090b"/><stop offset="1" stop-color="#27200c"/></linearGradient></defs><rect width="1200" height="675" fill="url(#g)"/><rect x="48" y="48" width="1104" height="579" rx="30" fill="none" stroke="#f5c451" stroke-width="2" opacity=".55"/><text x="90" y="120" fill="#f5f5f5" font-family="Arial, sans-serif" font-size="34" font-weight="700">AgentRanking</text><circle cx="600" cy="284" r="64" fill="#f5c451"/><path d="M570 284l20 20 42-48" fill="none" stroke="#17120a" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/><text x="600" y="390" text-anchor="middle" fill="#f5c451" font-family="Arial, sans-serif" font-size="32" font-weight="700" letter-spacing="5">NOW VERIFIED</text><text x="600" y="475" text-anchor="middle" fill="#fff" font-family="Arial, sans-serif" font-size="58" font-weight="700">${name}</text><text x="600" y="560" text-anchor="middle" fill="#d4d4d8" font-family="Arial, sans-serif" font-size="24">agentranking.io</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
