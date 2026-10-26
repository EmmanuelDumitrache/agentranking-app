/** Client-side PNG share card for the public agents index. */
import {
  SHARE,
  SHARE_FONT,
  drawAgentRankingWordmark,
  drawDashboardPanel,
  drawPublicWaveBackground,
  drawStatCell,
  downloadCanvasPng,
  formatShareDayDelta,
  formatShareDate,
  loadImage,
  roundRect,
} from "@/lib/public-site/share-card-canvas";
export type AgentsShareDayPoint = {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly tokenized: number;
  readonly verified: number;
};
export type AgentsShareCardInput = {
  readonly total: number;
  readonly today: number;
  readonly verified: number;
  readonly tokenized: number;
  readonly series: readonly AgentsShareDayPoint[];
  readonly generatedAt?: Date;
};
const W = 1200;
const H = 675;
const BAR_TOTAL = "rgba(255,255,255,0.88)";
const BAR_TOKENIZED = "#9945FF";
const BAR_VERIFIED = "rgba(255,255,255,0.38)";
function drawStatBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  label: string,
  value: number,
  accent?: string,
): void {
  drawStatCell(ctx, x, y, width, 112);
  if (accent) {
    ctx.fillStyle = accent;
    roundRect(ctx, x + 18, y + 18, 10, 10, 2);
    ctx.fill();
  }
  ctx.fillStyle = SHARE.textMuted;
  ctx.font = `600 14px ${SHARE_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText(label.toUpperCase(), x + (accent ? 36 : 20), y + 32);
  ctx.fillStyle = SHARE.text;
  ctx.font = `600 44px ${SHARE_FONT}`;
  ctx.fillText(String(value), x + 20, y + 88);
}
function drawGroupedBars(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  chartY: number,
  chartHeight: number,
  max: number,
  point: AgentsShareDayPoint,
  barWidth: number,
): void {
  const gap = 4;
  const totalWidth = barWidth * 3 + gap * 2;
  const startX = centerX - totalWidth / 2;
  const values = [
    { value: point.count, color: BAR_TOTAL },
    { value: point.tokenized, color: BAR_TOKENIZED },
    { value: point.verified, color: BAR_VERIFIED },
  ];
  values.forEach((entry, index) => {
    const height = Math.max(entry.value > 0 ? 6 : 2, (entry.value / max) * chartHeight);
    roundRect(
      ctx,
      startX + index * (barWidth + gap),
      chartY + chartHeight - height,
      barWidth,
      height,
      3,
    );
    ctx.fillStyle = entry.color;
    ctx.fill();
  });
}
function drawAgentChart(
  ctx: CanvasRenderingContext2D,
  series: readonly AgentsShareDayPoint[],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  drawDashboardPanel(ctx, x, y, width, height, 14);
  ctx.fillStyle = SHARE.textSecondary;
  ctx.font = `600 13px ${SHARE_FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("NEW AGENTS · LAST 7 DAYS", x + 24, y + 32);
  const chartWidth = Math.min(width - 96, 770);
  const chartX = x + (width - chartWidth) / 2;
  const chartY = y + 86;
  const chartHeight = height - 128;
  const max = Math.max(
    1,
    ...series.flatMap((point) => [point.count, point.tokenized, point.verified]),
  );
  const groupWidth = chartWidth / Math.max(series.length, 1);
  const barWidth = Math.min(14, groupWidth * 0.18);
  ctx.strokeStyle = SHARE.borderSoft;
  ctx.beginPath();
  ctx.moveTo(chartX, chartY + chartHeight);
  ctx.lineTo(chartX + chartWidth, chartY + chartHeight);
  ctx.stroke();
  series.forEach((point, index) => {
    const centerX = chartX + index * groupWidth + groupWidth / 2;
    const previousCount = index > 0 ? (series[index - 1]?.count ?? null) : null;
    const delta = formatShareDayDelta(point.count, previousCount);
    drawGroupedBars(ctx, centerX, chartY, chartHeight, max, point, barWidth);
    ctx.fillStyle = SHARE.text;
    ctx.font = `650 18px ${SHARE_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(String(point.count), centerX, chartY - 26);
    ctx.fillStyle = delta === "NEW" || delta.startsWith("+") ? "#b58aff" : SHARE.textMuted;
    ctx.font = `600 10px ${SHARE_FONT}`;
    ctx.fillText(delta, centerX, chartY - 9);
    ctx.fillStyle = SHARE.textMuted;
    ctx.font = `500 12px ${SHARE_FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(point.label, centerX, chartY + chartHeight + 20);
  });
}
export async function renderAgentsShareCard(
  input: AgentsShareCardInput,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create canvas");
  drawPublicWaveBackground(ctx, W, H);
  const logo = await loadImage("/ar-mark.png");
  drawAgentRankingWordmark(ctx, logo, 194, 28, {
    markHeight: 66,
    fontSize: 36,
    gap: 12,
  });
  const when = input.generatedAt ?? new Date();
  ctx.textAlign = "right";
  ctx.font = `500 14px ${SHARE_FONT}`;
  ctx.fillText(formatShareDate(when), W - 44, 52);
  ctx.fillStyle = SHARE.textFaint;
  ctx.font = `500 13px ${SHARE_FONT}`;
  ctx.fillText("agentranking.io/agents", W - 44, 74);
  const statsY = 118;
  const gap = 10;
  const statWidth = (W - 88 - gap * 3) / 4;
  drawStatBox(ctx, 44, statsY, statWidth, "Total", input.total, BAR_TOTAL);
  drawStatBox(ctx, 44 + statWidth + gap, statsY, statWidth, "Today", input.today);
  drawStatBox(
    ctx,
    44 + (statWidth + gap) * 2,
    statsY,
    statWidth,
    "Verified",
    input.verified,
    BAR_VERIFIED,
  );
  drawStatBox(
    ctx,
    44 + (statWidth + gap) * 3,
    statsY,
    statWidth,
    "Tokenized",
    input.tokenized,
    BAR_TOKENIZED,
  );
  drawAgentChart(ctx, input.series, 44, 248, W - 88, 369);
  ctx.fillStyle = SHARE.textFaint;
  ctx.font = `500 12px ${SHARE_FONT}`;
  ctx.textAlign = "center";
  ctx.fillText("Built and launched on AgentRanking.io", W / 2, H - 18);
  return canvas;
}
export async function downloadAgentsSharePng(
  input: AgentsShareCardInput,
): Promise<void> {
  const canvas = await renderAgentsShareCard(input);
  const stamp = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  await downloadCanvasPng(canvas, `agentranking-agents-${stamp}.png`);
}
