import sharp from "sharp";
import { ROBINHOOD_CHAIN_CONFIG } from "@/lib/robinhood-chain/config";
import { resolveUploadPublicUrl } from "@/lib/public-media-url";
import { addBytesToKubo, assertKuboContentAvailable } from "@/lib/ipfs/kubo";
import { requestPublicHttp } from "@/lib/outbound-http";
const ALLOWED_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 4.5 * 1024 * 1024;
const TARGET_SIZE = 512;
/** Soft cap while downloading before we resize — oversized sources are still accepted. */
const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
export type PreparedRobinhoodLogo = {
  originalUrl: string;
  ipfsCid: string;
  ipfsUri: string;
  gatewayUrl: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
};
function sniffMime(buffer: Buffer, headerType: string | null): string | null {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    buffer.length >= 6 &&
    (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return "image/gif";
  }
  const normalized = headerType?.split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_MIME.has(normalized) ? normalized : null;
}
function looksLikeHtml(buffer: Buffer, contentType: string | null): boolean {
  const ct = contentType?.toLowerCase() ?? "";
  if (ct.includes("text/html") || ct.includes("application/json")) return true;
  const head = buffer.subarray(0, 256).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("{");
}
async function fetchImageBytes(sourceUrl: string): Promise<{ buffer: Buffer; contentType: string | null }> {
  let response;
  try {
    response = await requestPublicHttp(sourceUrl, {
      method: "GET",
      headers: { Accept: "image/*" },
      timeoutMs: 30_000,
      maxResponseBytes: MAX_DOWNLOAD_BYTES,
      maxRedirects: 3,
      allowHttp: process.env.NODE_ENV !== "production",
      allowLocalhost: process.env.NODE_ENV !== "production",
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : String(error);
    if (message.includes("exceeded") || message.includes("too large")) {
      throw new Error(
        "Token image is too large to process. Upload a smaller PNG or JPEG (under ~10MB) and try again.",
      );
    }
    throw new Error(
      "Could not securely download the token image. Upload a new image on the launch form and try again.",
    );
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Token image URL returned HTTP ${response.status}. Upload a new image on the launch form and try again.`,
    );
  }
  if (response.truncated) {
    throw new Error(
      "Token image is too large to process. Upload a smaller PNG or JPEG (under ~10MB) and try again.",
    );
  }
  const contentTypeHeader = response.headers["content-type"];
  const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] ?? null : contentTypeHeader ?? null;
  const buffer = response.bodyBytes;
  if (!buffer.length) {
    throw new Error("Token image was empty. Upload a new image and try again.");
  }
  if (looksLikeHtml(buffer, contentType)) {
    throw new Error(
      "Token image URL returned a webpage instead of an image. Upload a new image on the launch form.",
    );
  }
  return { buffer, contentType };
}
/**
 * Fail-safe normalize: any valid raster becomes a square 512 PNG.
 * Non-square / tiny / huge sources are resized or center-cropped — no user action needed.
 */
async function normalizeToLaunchPng(buffer: Buffer): Promise<Buffer> {
  let pinBuffer: Buffer;
  try {
    pinBuffer = await sharp(buffer, { animated: false, failOn: "none" })
      .rotate()
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "centre" })
      .png({ compressionLevel: 8 })
      .toBuffer();
  } catch {
    throw new Error(
      "Could not process this token image. Upload a PNG, JPEG, WebP, or GIF and try again.",
    );
  }
  if (pinBuffer.byteLength > MAX_BYTES) {
    pinBuffer = await sharp(pinBuffer)
      .png({ compressionLevel: 9, palette: true, quality: 80 })
      .toBuffer();
  }
  if (pinBuffer.byteLength > MAX_BYTES) {
    throw new Error(
      "Token image is still too large after compression. Upload a simpler PNG or JPEG and try again.",
    );
  }
  return pinBuffer;
}
async function pinBufferToKubo(input: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<{ cid: string; gatewayUrl: string }> {
  const uploaded = await addBytesToKubo({
    bytes: new Uint8Array(input.buffer),
    filename: input.filename,
    contentType: input.mimeType,
    pin: true,
  });
  return { cid: uploaded.cid, gatewayUrl: uploaded.gatewayUrl };
}
export function assertRobinhoodLogoEnv(): void {
  if (!ROBINHOOD_CHAIN_CONFIG.rpcUrl) {
    throw new Error("ROBINHOOD_CHAIN_RPC_URL is required.");
  }
}
/**
 * Prepare on-chain logo: fetch → auto-resize/crop to 512 PNG → pin via Kubo RPC → verify through the private Kubo cat RPC.
 * Fail-safes that need the user: clear errors asking to upload a new image.
 * Fail-safes that don't: automatic resize/crop for non-square or odd sizes.
 * On-chain logo must be `ipfs://<cid>` (stable for indexers). Gateway HTTPS is for verify/display only.
 */
export async function prepareRobinhoodTokenLogo(input: {
  sourceUrl: string;
  agentId?: number | null;
  tokenName?: string | null;
  tokenSymbol?: string | null;
}): Promise<PreparedRobinhoodLogo> {
  assertRobinhoodLogoEnv();
  const sourceUrl = resolveUploadPublicUrl(input.sourceUrl.trim());
  if (!sourceUrl) {
    throw new Error("Token logo is required. Upload an image on the launch form.");
  }
  const { buffer, contentType } = await fetchImageBytes(sourceUrl);
  const mimeType = sniffMime(buffer, contentType);
  if (!mimeType || !ALLOWED_MIME.has(mimeType)) {
    throw new Error(
      "Token image must be PNG, JPEG, WebP, or GIF. Upload a new image on the launch form.",
    );
  }
  const pinBuffer = await normalizeToLaunchPng(buffer);
  const label = input.agentId
    ? `robinhood-agent-${input.agentId}-logo`
    : "robinhood-launch-logo";
  const uploaded = await pinBufferToKubo({
    buffer: pinBuffer,
    mimeType: "image/png",
    filename: `${label}.png`,
  });
  const cid = uploaded.cid;
  const ipfsUri = `ipfs://${cid}`;
  const gatewayUrl = uploaded.gatewayUrl;
  await assertKuboContentAvailable(cid);
  const outMeta = await sharp(pinBuffer).metadata();
  return {
    originalUrl: sourceUrl,
    ipfsCid: cid,
    ipfsUri,
    gatewayUrl,
    mimeType: "image/png",
    sizeBytes: pinBuffer.byteLength,
    width: outMeta.width ?? TARGET_SIZE,
    height: outMeta.height ?? TARGET_SIZE,
  };
}
