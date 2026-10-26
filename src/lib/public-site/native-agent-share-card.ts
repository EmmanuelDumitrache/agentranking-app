/** Client-side PNG share card for a public AR (native) agent detail page. */
import {
  SHARE,
  SHARE_FONT,
  drawAgentRankingWordmark,
  drawFallbackAvatar,
  drawPublicWaveBackground,
  drawRoundedImage,
  drawStatCell,
  downloadCanvasPng,
  formatShareDate,
  loadImage,
} from "@/lib/public-site/share-card-canvas";
export type NativeAgentShareCardInput = {
  readonly agentName: string;
  readonly imageUrl: string | null;
  readonly chainLabel: string;
  readonly chainIcon: "solana" | "evm" | null;
  readonly verified: boolean;
  readonly tokenized: boolean;
  readonly scoreLabel: string;
  readonly verificationLabel: string;
  readonly tokenLabel: string;
  readonly sharePath: string;
  readonly generatedAt?: Date;
};
/** Near-square social format — matches token detail share card. */
const W = 1080;
const H = 1080;
const PUBLIC_ORIGIN = "https://agentranking.io";
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
  ctx.font = `600 48px ${SHARE_FONT}`;
  const truncated = value.length > 14 ? `${value.slice(0, 13)}…` : value;
  ctx.fillText(truncated, cx, y + h * 0.62);
  ctx.textBaseline = "alphabetic";
}
function drawAgentArtwork(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  agentName: string,
  x: number,
  y: number,
  size: number,
): void {
  if (image) {
    drawRoundedImage(ctx, image, x, y, size, Math.round(size * 0.24));
    return;
  }
  drawFallbackAvatar(ctx, x, y, size, agentName);
}
export function nativeAgentPublicUrl(sharePath: string): string {
  const path = sharePath.startsWith("/") ? sharePath : `/${sharePath}`;
  return `${PUBLIC_ORIGIN}${path}`;
}
export async function renderNativeAgentShareCard(
  input: NativeAgentShareCardInput,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas");
  drawPublicWaveBackground(ctx, W, H);
  const [logo, agentImg] = await Promise.all([
    loadImage("/ar-mark.png"),
    input.imageUrl ? loadImage(input.imageUrl) : Promise.resolve(null),
  ]);
  const when = input.generatedAt ?? new Date();
  drawAgentRankingWordmark(ctx, logo, W / 2, 36, {
    markHeight: 52,
    fontSize: 30,
    gap: 12,
  });
  const avatarSize = 300;
  const avatarX = (W - avatarSize) / 2;
  const avatarY = 168;
  drawAgentArtwork(ctx, agentImg, input.agentName, avatarX, avatarY, avatarSize);
  const identityBase = avatarY + avatarSize;
  ctx.textAlign = "center";
  ctx.fillStyle = SHARE.text;
  ctx.font = `700 68px ${SHARE_FONT}`;
  const name =
    input.agentName.length > 22 ? `${input.agentName.slice(0, 20)}…` : input.agentName;
  ctx.fillText(name, W / 2, identityBase + 78);
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `600 30px ${SHARE_FONT}`;
  ctx.fillText("AR Agent", W / 2, identityBase + 126);
  // Metrics sit under identity — equal columns, centered label + value
  const boxY = 690;
  const boxGap = 12;
  const boxX = 36;
  const boxW = (W - 72 - boxGap * 2) / 3;
  const boxH = 172;
  drawStatBox(ctx, boxX, boxY, boxW, boxH, "AR Score", input.scoreLabel);
  drawStatBox(
    ctx,
    boxX + boxW + boxGap,
    boxY,
    boxW,
    boxH,
    "Verification",
    input.verificationLabel,
  );
  drawStatBox(
    ctx,
    boxX + (boxW + boxGap) * 2,
    boxY,
    boxW,
    boxH,
    "Token",
    input.tokenLabel,
  );
  const footerY = boxY + boxH + 44;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `500 20px ${SHARE_FONT}`;
  ctx.fillText(`As of ${formatShareDate(when)}`, W / 2, footerY);
  ctx.fillStyle = SHARE.textFaint;
  ctx.font = `500 18px ${SHARE_FONT}`;
  ctx.fillText("On AgentRanking.io", W / 2, footerY + 30);
  return canvas;
}
export async function downloadNativeAgentSharePng(
  input: NativeAgentShareCardInput,
): Promise<void> {
  const canvas = await renderNativeAgentShareCard(input);
  const slug = (input.agentName || "agent")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .slice(0, 32);
  const stamp = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  await downloadCanvasPng(canvas, `agentranking-agent-${slug}-${stamp}.png`);
}
