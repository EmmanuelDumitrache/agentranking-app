import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateProbeUrl } from "@/lib/endpoint-probe-url";
import { requestPublicHttp } from "@/lib/outbound-http";
import { detectImageMimeType } from "@/lib/image-upload-validation";
export const SOCIAL_OG_WIDTH = 1200;
export const SOCIAL_OG_HEIGHT = 630;
const MAX_REMOTE_IMAGE_BYTES = 5 * 1024 * 1024;
let markDataPromise: Promise<string | null> | null = null;
export function imageDataUrl(contentType: string, bytes: Buffer): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}
export async function loadSocialOgMarkDataUrl(): Promise<string | null> {
  markDataPromise ??= readFile(path.join(process.cwd(), "public", "ar-mark.png"))
    .then((bytes) => imageDataUrl("image/png", bytes))
    .catch(() => null);
  return markDataPromise;
}
function contentTypeForPublicPath(relative: string): string {
  const ext = path.extname(relative).toLowerCase();
  switch (ext) {
    case ".svg":
      return "image/svg+xml";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    default:
      return "image/png";
  }
}
async function loadLocalPublicImageDataUrl(relativePath: string): Promise<string | null> {
  const relative = relativePath.replace(/^\/+/, "");
  if (!relative || relative.includes("..")) return null;
  try {
    const bytes = await readFile(path.join(process.cwd(), "public", relative));
    return imageDataUrl(contentTypeForPublicPath(relative), bytes);
  } catch {
    return null;
  }
}
export async function loadSocialOgImageDataUrl(raw: string | null | undefined): Promise<string | null> {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return loadLocalPublicImageDataUrl(trimmed);
  }
  const checked = validateProbeUrl(trimmed);
  if (!checked.ok) return null;
  try {
    const response = await requestPublicHttp(checked.url.toString(), {
      method: "GET",
      timeoutMs: 3_000,
      maxResponseBytes: MAX_REMOTE_IMAGE_BYTES,
      maxRedirects: 3,
      allowHttp: true,
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg" },
    });
    if (response.status < 200 || response.status >= 300 || response.truncated) return null;
    const rawContentType = Array.isArray(response.headers["content-type"])
      ? response.headers["content-type"][0]
      : response.headers["content-type"];
    const declaredType = rawContentType?.split(";")[0]?.trim().toLowerCase() ?? "";
    const detectedType = detectImageMimeType(response.bodyBytes);
    if (!detectedType || detectedType !== declaredType) return null;
    return imageDataUrl(detectedType, response.bodyBytes);
  } catch {
    return null;
  }
}
export function socialOgInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "A";
}
export function socialOgTitleSize(name: string): number {
  if (name.length > 28) return 58;
  if (name.length > 18) return 68;
  return 78;
}
