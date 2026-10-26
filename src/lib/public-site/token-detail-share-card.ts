/** Client-side PNG share card for a single public token detail page. */
import {
  SHARE,
  SHARE_FONT,
  drawAgentRankingWordmark,
  drawEthLogo,
  drawFallbackAvatar,
  drawPublicWaveBackground,
  drawRoundedImage,
  drawStatCell,
  downloadCanvasPng,
  formatShareDate,
  loadImage,
} from "@/lib/public-site/share-card-canvas";
export type TokenDetailShareCardInput = {
  readonly tokenName: string;
  readonly symbol: string;
  readonly tokenImageUrl: string | null;
  readonly chainLabel: "Solana" | "EVM";
  readonly venueLabel: string;
  readonly sharePath: string;
  readonly agentName?: string | null;
  readonly agentImageUrl?: string | null;
  readonly priceLabel: string;
  readonly mcapLabel: string;
  readonly volumeLabel: string;
  readonly generatedAt?: Date;
};
/** Near-square social format. */
const W = 1080;
const H = 1080;
const PUBLIC_ORIGIN = "https://agentranking.io";
function getPillWidth(
  ctx: CanvasRenderingContext2D,
  label: string,
  icon: "solana" | "evm" | null = null,
): number {
  ctx.font = `600 26px ${SHARE_FONT}`;
  return ctx.measureText(label).width + 44 + (icon ? 28 : 0);
}
function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  opts?: {
    readonly solanaImg?: HTMLImageElement | null;
    readonly icon?: "solana" | "evm" | null;
  },
): number {
  const icon = opts?.icon ?? null;
  const padX = 20;
  const w = getPillWidth(ctx, label, icon);
  const h = 48;
  let textX = x + padX;
  if (icon === "solana" && opts?.solanaImg) {
    ctx.drawImage(opts.solanaImg, textX, y + 12, 22, 22);
    textX += 28;
  } else if (icon === "evm") {
    drawEthLogo(ctx, textX, y + 11, 22);
    textX += 26;
  }
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = `600 26px ${SHARE_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, textX, y + h / 2);
  ctx.textBaseline = "alphabetic";
  return w + 16;
}
function drawStatBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
): void {
  drawStatCell(ctx, x, y, w, h);
  const cx = x + w / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = SHARE.textMuted;
  ctx.font = `600 18px ${SHARE_FONT}`;
  ctx.fillText(label.toUpperCase(), cx, y + h * 0.32);
  ctx.fillStyle = SHARE.text;
  ctx.font = `600 52px ${SHARE_FONT}`;
  const truncated = value.length > 12 ? `${value.slice(0, 11)}…` : value;
  ctx.fillText(truncated, cx, y + h * 0.62);
  ctx.textBaseline = "alphabetic";
}
function drawTokenArtwork(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  tokenName: string,
  x: number,
  y: number,
  size: number,
): void {
  if (image) {
    drawRoundedImage(ctx, image, x, y, size, Math.round(size * 0.24));
    return;
  }
  drawFallbackAvatar(ctx, x, y, size, tokenName);
}
export function tokenDetailPublicUrl(sharePath: string): string {
  const path = sharePath.startsWith("/") ? sharePath : `/${sharePath}`;
  return `${PUBLIC_ORIGIN}${path}`;
}
export async function renderTokenDetailShareCard(
  input: TokenDetailShareCardInput,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas");
  drawPublicWaveBackground(ctx, W, H);
  const [logo, tokenImg, solanaImg] = await Promise.all([
    loadImage("/ar-mark.png"),
    input.tokenImageUrl ? loadImage(input.tokenImageUrl) : Promise.resolve(null),
    loadImage("/branding/solana/solanaLogoMark.svg"),
  ]);
  const when = input.generatedAt ?? new Date();
  drawAgentRankingWordmark(ctx, logo, W / 2, 36, {
    markHeight: 52,
    fontSize: 30,
    gap: 12,
  });
  // Identity block: larger art + type, centered lower in the card
  const tokenSize = 300;
  const tokenX = (W - tokenSize) / 2;
  const tokenY = 168;
  drawTokenArtwork(ctx, tokenImg, input.tokenName, tokenX, tokenY, tokenSize);
  const identityBase = tokenY + tokenSize;
  ctx.textAlign = "center";
  ctx.fillStyle = SHARE.text;
  ctx.font = `700 68px ${SHARE_FONT}`;
  const name =
    input.tokenName.length > 22 ? `${input.tokenName.slice(0, 20)}…` : input.tokenName;
  ctx.fillText(name, W / 2, identityBase + 78);
  if (input.symbol) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `600 34px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.fillText(input.symbol, W / 2, identityBase + 126);
  }
  const chainIcon = input.chainLabel === "Solana" ? "solana" : "evm";
  const pillGap = 16;
  const pillsWidth =
    getPillWidth(ctx, input.chainLabel, chainIcon) +
    getPillWidth(ctx, input.venueLabel) +
    pillGap;
  let pillX = (W - pillsWidth) / 2;
  const pillY = identityBase + 152;
  pillX += drawPill(ctx, pillX, pillY, input.chainLabel, {
    icon: chainIcon,
    solanaImg,
  });
  drawPill(ctx, pillX, pillY, input.venueLabel);
  // Metrics + footer sit higher and larger under the identity block
  const boxY = 720;
  const boxGap = 12;
  const boxX = 36;
  const boxW = (W - 72 - boxGap * 2) / 3;
  const boxH = 172;
  drawStatBox(ctx, boxX, boxY, boxW, boxH, "Price", input.priceLabel);
  drawStatBox(ctx, boxX + boxW + boxGap, boxY, boxW, boxH, "Market Cap", input.mcapLabel);
  drawStatBox(ctx, boxX + (boxW + boxGap) * 2, boxY, boxW, boxH, "24h Volume", input.volumeLabel);
  const footerY = boxY + boxH + 44;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 20px ${SHARE_FONT}`;
  ctx.fillText(`As of ${formatShareDate(when)}`, W / 2, footerY);
  ctx.fillStyle = SHARE.textFaint;
  ctx.font = `500 18px ${SHARE_FONT}`;
  ctx.fillText("Launched on AgentRanking.io", W / 2, footerY + 30);
  return canvas;
}
export async function downloadTokenDetailSharePng(
  input: TokenDetailShareCardInput,
): Promise<void> {
  const canvas = await renderTokenDetailShareCard(input);
  const slug = (input.symbol || input.tokenName || "token")
    .replace(/^\$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 32);
  const stamp = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  await downloadCanvasPng(canvas, `agentranking-${slug}-${stamp}.png`);
}
