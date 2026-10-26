/** Client-side PNG share card for the public tokens market stats. */
import {
  SHARE,
  SHARE_FONT,
  drawAgentRankingWordmark,
  drawDashboardPanel,
  drawEthLogo,
  drawPublicWaveBackground,
  drawStatCell,
  downloadCanvasPng,
  formatShareDayDelta,
  formatShareDate,
  loadImage,
  roundRect,
} from "@/lib/public-site/share-card-canvas";
export type TokensShareDayPoint = {
  readonly key: string;
  readonly label: string;
  readonly solana: number;
  readonly evm: number;
};
export type TokensShareCardInput = {
  readonly total: number;
  readonly solana: number;
  readonly evm: number;
  readonly series: readonly TokensShareDayPoint[];
  readonly generatedAt?: Date;
};
const W = 1200;
const H = 675;
function drawLabelWithIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  icon: "none" | "solana" | "evm",
  solanaImg: HTMLImageElement | null,
): void {
  let cursor = x;
  if (icon === "solana" && solanaImg) {
    ctx.drawImage(solanaImg, cursor, y - 11, 14, 14);
    cursor += 18;
  } else if (icon === "evm") {
    drawEthLogo(ctx, cursor, y - 12, 14);
    cursor += 16;
  }
  ctx.fillStyle = SHARE.textSecondary;
  ctx.font = `600 14px ${SHARE_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label.toUpperCase(), cursor, y);
}
function drawStatBox(
  ctx: CanvasRenderingContext2D,
  box: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  label: string,
  value: string,
  icon: "none" | "solana" | "evm",
  solanaImg: HTMLImageElement | null,
): void {
  drawStatCell(ctx, box.x, box.y, box.w, box.h);
  drawLabelWithIcon(ctx, box.x + 22, box.y + 34, label, icon, solanaImg);
  ctx.fillStyle = SHARE.text;
  ctx.font = `700 48px ${SHARE_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(value, box.x + 22, box.y + box.h - 24);
}
function drawDualLaunchChart(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  series: readonly TokensShareDayPoint[],
): void {
  drawDashboardPanel(ctx, x, y, w, h, 14);
  ctx.fillStyle = SHARE.textSecondary;
  ctx.font = `600 13px ${SHARE_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("LAUNCHES · LAST 7 DAYS", x + 24, y + 32);
  const chartW = Math.min(w - 96, 770);
  const chartX = x + (w - chartW) / 2;
  const chartY = y + 86;
  const chartH = h - 128;
  const max = Math.max(1, ...series.flatMap((d) => [d.solana, d.evm]));
  const groupW = chartW / Math.max(series.length, 1);
  const barW = Math.min(20, groupW * 0.24);
  const gap = 6;
  // Baseline
  ctx.strokeStyle = SHARE.borderSoft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartX, chartY + chartH);
  ctx.lineTo(chartX + chartW, chartY + chartH);
  ctx.stroke();
  series.forEach((day, i) => {
    const cx = chartX + i * groupW + groupW / 2;
    const total = day.solana + day.evm;
    const previous = i > 0 ? series[i - 1] : undefined;
    const previousTotal = previous ? previous.solana + previous.evm : null;
    const delta = formatShareDayDelta(total, previousTotal);
    const solH = Math.max(day.solana > 0 ? 5 : 1.5, (day.solana / max) * chartH);
    const evmH = Math.max(day.evm > 0 ? 5 : 1.5, (day.evm / max) * chartH);
    ctx.fillStyle = "#9945FF";
    roundRect(ctx, cx - barW - gap / 2, chartY + chartH - solH, barW, solH, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    roundRect(ctx, cx + gap / 2, chartY + chartH - evmH, barW, evmH, 3);
    ctx.fill();
    ctx.fillStyle = SHARE.text;
    ctx.font = `650 18px ${SHARE_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(String(total), cx, chartY - 26);
    ctx.fillStyle = delta === "NEW" || delta.startsWith("+") ? "#b58aff" : SHARE.textMuted;
    ctx.font = `600 10px ${SHARE_FONT}`;
    ctx.fillText(delta, cx, chartY - 9);
    ctx.fillStyle = SHARE.textMuted;
    ctx.font = `500 12px ${SHARE_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(day.label, cx, chartY + chartH + 20);
  });
}
/** Draw a 1200×675 AgentRanking tokens market share card. */
export async function renderTokensShareCard(
  input: TokensShareCardInput,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas");
  drawPublicWaveBackground(ctx, W, H);
  const [logo, solanaImg] = await Promise.all([
    loadImage("/ar-mark.png"),
    loadImage("/branding/solana/solanaLogoMark.svg"),
  ]);
  drawAgentRankingWordmark(ctx, logo, 194, 28, {
    markHeight: 66,
    fontSize: 36,
    gap: 12,
  });
  const when = input.generatedAt ?? new Date();
  ctx.textAlign = "right";
  ctx.fillStyle = SHARE.textMuted;
  ctx.font = `500 14px ${SHARE_FONT}`;
  ctx.fillText(formatShareDate(when), W - 44, 52);
  ctx.fillStyle = SHARE.textFaint;
  ctx.font = `500 13px ${SHARE_FONT}`;
  ctx.fillText("agentranking.io/tokens", W - 44, 74);
  const boxY = 118;
  const boxH = 118;
  const boxGap = 14;
  const boxW = (W - 88 - boxGap * 2) / 3;
  drawStatBox(
    ctx,
    { x: 44, y: boxY, w: boxW, h: boxH },
    "Total",
    String(input.total),
    "none",
    solanaImg,
  );
  drawStatBox(
    ctx,
    { x: 44 + boxW + boxGap, y: boxY, w: boxW, h: boxH },
    "Solana",
    String(input.solana),
    "solana",
    solanaImg,
  );
  drawStatBox(
    ctx,
    { x: 44 + (boxW + boxGap) * 2, y: boxY, w: boxW, h: boxH },
    "EVM",
    String(input.evm),
    "evm",
    solanaImg,
  );
  drawDualLaunchChart(
    ctx,
    44,
    boxY + boxH + 18,
    W - 88,
    H - (boxY + boxH + 18) - 42,
    input.series,
  );
  ctx.fillStyle = SHARE.textFaint;
  ctx.font = `500 12px ${SHARE_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("Multi-chain agent token launches · Live snapshot", W / 2, H - 18);
  return canvas;
}
export async function downloadTokensSharePng(input: TokensShareCardInput): Promise<void> {
  const canvas = await renderTokensShareCard(input);
  const stamp = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  await downloadCanvasPng(canvas, `agentranking-tokens-${stamp}.png`);
}
