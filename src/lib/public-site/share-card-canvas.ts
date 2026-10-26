/** Shared canvas helpers for AgentRanking social share PNGs (public-site look). */
export const SHARE_FONT =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
/** Dashboard panel colors (approx of oklch tokens). */
export const SHARE = {
  bg: "#000000",
  waveFront: "#1a1a1a",
  text: "#fafafa",
  textSecondary: "rgba(255,255,255,0.55)",
  textMuted: "rgba(255,255,255,0.38)",
  textFaint: "rgba(255,255,255,0.22)",
  border: "rgba(255,255,255,0.12)",
  borderSoft: "rgba(255,255,255,0.08)",
  panelTop: "rgba(32,32,32,0.92)",
  panelBottom: "rgba(22,22,22,0.92)",
  inset: "rgba(255,255,255,0.035)",
  cellBg: "rgba(12,12,12,0.88)",
} as const;
export function formatShareDayDelta(
  current: number,
  previous: number | null,
): string {
  if (previous == null || (previous === 0 && current === 0)) return "—";
  if (previous === 0) return "NEW";
  const percent = Math.round(((current - previous) / previous) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}
const BAYER_8X8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39,
  13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
] as const;
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
/**
 * Site PublicWaveBackground: black + #1a1a1a Bayer-8x8 dithered wave (static snapshot).
 * Matches DitheringShader shape=wave, type=8x8, pxSize=5, colorBack=#000, colorFront=#1a1a1a.
 */
export function drawPublicWaveBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts?: { readonly time?: number; readonly pxSize?: number },
): void {
  const pxSize = opts?.pxSize ?? 5;
  const t = 0.5 * (opts?.time ?? 2.4);
  const cols = Math.ceil(width / pxSize);
  const rows = Math.ceil(height / pxSize);
  ctx.fillStyle = SHARE.bg;
  ctx.fillRect(0, 0, width, height);
  const front = SHARE.waveFront;
  for (let iy = 0; iy < rows; iy += 1) {
    for (let ix = 0; ix < cols; ix += 1) {
      const pxSizeUvX = (ix * pxSize + pxSize * 0.5 - width * 0.5) / pxSize;
      const pxSizeUvY = (iy * pxSize + pxSize * 0.5 - height * 0.5) / pxSize;
      let shapeUvX = Math.floor(pxSizeUvX) * pxSize / width;
      let shapeUvY = Math.floor(pxSizeUvY) * pxSize / height;
      shapeUvX *= 4;
      shapeUvY *= 4;
      const wave =
        Math.cos(0.5 * shapeUvX - 2 * t) *
        Math.sin(1.5 * shapeUvX + t) *
        (0.75 + 0.25 * Math.cos(3 * t));
      const shape = 1 - smoothstep(-1, 1, shapeUvY + wave);
      const bx = ((ix % 8) + 8) % 8;
      const by = ((iy % 8) + 8) % 8;
      const dither = (BAYER_8X8[by * 8 + bx] ?? 0) / 64 - 0.5;
      if (shape + dither >= 0.5) {
        ctx.fillStyle = front;
        ctx.fillRect(ix * pxSize, iy * pxSize, pxSize, pxSize);
      }
    }
  }
}
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
/** Dashboard-style panel: raised→panel gradient, hairline border, inset highlight. */
export function drawDashboardPanel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 14,
): void {
  roundRect(ctx, x, y, w, h, radius);
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, SHARE.panelTop);
  grad.addColorStop(1, SHARE.panelBottom);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = SHARE.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Inset top highlight
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 1);
  ctx.lineTo(x + w - 1, y + 1);
  ctx.stroke();
  ctx.restore();
}
/** Stat cell like TokensMarketStats grid (bg-background/80 feel). */
export function drawStatCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = SHARE.cellBg;
  ctx.fill();
  ctx.strokeStyle = SHARE.borderSoft;
  ctx.lineWidth = 1;
  ctx.stroke();
}
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  const resolved = resolveShareCardImageSrc(src);
  if (!resolved) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    // Proxied / same-origin sources don't need CORS; setting it can break some SVGs.
    if (isCrossOriginUrl(resolved)) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = resolved;
  });
}
/** Route remote PFPs through a same-origin proxy so canvas export isn't blocked by CORS. */
export function resolveShareCardImageSrc(src: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:") || trimmed.startsWith("blob:")) return trimmed;
  // Relative site asset (logo, fallback, etc.)
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  let absolute: URL;
  try {
    const base =
      typeof globalThis.location?.origin === "string"
        ? globalThis.location.origin
        : "https://agentranking.io";
    absolute = new URL(trimmed, base);
  } catch {
    return null;
  }
  if (absolute.protocol !== "http:" && absolute.protocol !== "https:") {
    return null;
  }
  // Already on our origin — use path so canvas stays untainted.
  if (
    typeof globalThis.location?.origin === "string" &&
    absolute.origin === globalThis.location.origin
  ) {
    return `${absolute.pathname}${absolute.search}`;
  }
  return `/api/share-card/image?url=${encodeURIComponent(absolute.toString())}`;
}
function isCrossOriginUrl(src: string): boolean {
  if (src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("/")) {
    return false;
  }
  try {
    if (typeof globalThis.location?.origin !== "string") return true;
    return new URL(src, globalThis.location.origin).origin !== globalThis.location.origin;
  } catch {
    return false;
  }
}
export function drawContainedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}
/** Canvas equivalent of AgentRankingWordmark: contained mark + bold Agent / regular Ranking. */
export function drawAgentRankingWordmark(
  ctx: CanvasRenderingContext2D,
  mark: HTMLImageElement | null,
  centerX: number,
  y: number,
  opts?: {
    readonly markHeight?: number;
    readonly fontSize?: number;
    readonly gap?: number;
  },
): void {
  const markHeight = opts?.markHeight ?? 48;
  const fontSize = opts?.fontSize ?? 28;
  const gap = opts?.gap ?? 12;
  const markWidth = mark
    ? markHeight * (mark.naturalWidth / mark.naturalHeight)
    : markHeight * 1.2;
  ctx.font = `700 ${fontSize}px ${SHARE_FONT}`;
  const agentWidth = ctx.measureText("Agent").width;
  ctx.font = `400 ${fontSize}px ${SHARE_FONT}`;
  const rankingWidth = ctx.measureText("Ranking").width;
  const totalWidth = markWidth + gap + agentWidth + rankingWidth;
  const startX = centerX - totalWidth / 2;
  if (mark) {
    drawContainedImage(ctx, mark, startX, y, markWidth, markHeight);
  } else {
    roundRect(ctx, startX, y, markWidth, markHeight, 10);
    ctx.fillStyle = SHARE.text;
    ctx.fill();
  }
  const textX = startX + markWidth + gap;
  const baseline = y + markHeight / 2 + fontSize * 0.35;
  ctx.textAlign = "left";
  ctx.fillStyle = SHARE.text;
  ctx.font = `700 ${fontSize}px ${SHARE_FONT}`;
  ctx.fillText("Agent", textX, baseline);
  ctx.font = `400 ${fontSize}px ${SHARE_FONT}`;
  ctx.fillText("Ranking", textX + agentWidth, baseline);
}
export function formatShareDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
/** Ethereum diamond mark (matches EthereumIcon proportions). */
export function drawEthLogo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color = "rgba(255,255,255,0.85)",
): void {
  const s = size / 14;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  // viewBox roughly 0 0 14 14 mapped from 256×417 diamond
  const sx = 14 / 256;
  const sy = 14 / 417;
  ctx.scale(sx, sy);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.78;
  ctx.beginPath();
  ctx.moveTo(127.961, 0);
  ctx.lineTo(125.166, 9.5);
  ctx.lineTo(125.166, 285.168);
  ctx.lineTo(127.961, 287.958);
  ctx.lineTo(255.923, 212.32);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.52;
  ctx.beginPath();
  ctx.moveTo(127.962, 0);
  ctx.lineTo(0, 212.32);
  ctx.lineTo(127.962, 287.959);
  ctx.lineTo(127.962, 154.158);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.moveTo(127.961, 287.958);
  ctx.lineTo(255.921, 212.321);
  ctx.lineTo(127.961, 154.159);
  ctx.lineTo(125.166, 139.097);
  ctx.lineTo(125.166, 287.958);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.82;
  ctx.beginPath();
  ctx.moveTo(0, 212.32);
  ctx.lineTo(127.96, 287.958);
  ctx.lineTo(127.96, 154.158);
  ctx.lineTo(125.165, 139.096);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
export function drawRoundedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  radius: number,
): void {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  if (!nw || !nh) return;
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  const scale = Math.max(size / nw, size / nh);
  const drawWidth = nw * scale;
  const drawHeight = nh * scale;
  ctx.drawImage(
    img,
    x + (size - drawWidth) / 2,
    y + (size - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  ctx.restore();
}
export function drawFallbackAvatar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  label: string,
): void {
  roundRect(ctx, x, y, size, size, size * 0.22);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `700 ${Math.round(size * 0.36)}px ${SHARE_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText((label || "?").charAt(0).toUpperCase(), x + size / 2, y + size / 2);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}
/** Encode through the asynchronous canvas API so PNG compression does not synchronously block the UI thread. */
export async function downloadCanvasPng(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("Canvas PNG encoding failed"));
    }, "image/png");
  });
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.download = filename;
    link.href = objectUrl;
    link.click();
  } finally {
    // A background tab may never receive another animation frame. A task delay keeps
    // the URL alive through the synthetic click without depending on rendering.
    globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}
