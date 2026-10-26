import "server-only";

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { addBytesToKubo } from "@/lib/ipfs/kubo";
import { resolveUploadPublicUrl } from "@/lib/public-media-url";
import { resolveUploadedFilePath } from "@/lib/upload";

function isLocalHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}

function isPublicMetadataImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("ipfs://")) return true;
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    if (isLocalHostname(host)) return false;
    if (host === "app.agentranking.io" || host === "agentranking.io") return true;
    if (host.includes("arweave.net") || host.includes("irys.xyz")) return true;
    return !parsed.pathname.startsWith("/uploads/");
  } catch {
    return false;
  }
}

function contentTypeFromPath(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/**
 * Ensure Pump/IPFS metadata references a publicly fetchable token image.
 * Local `/uploads/` paths are read from disk and pinned to Kubo.
 */
export async function resolveTokenImageForMetadata(input: {
  tokenImageUrl: string | null | undefined;
  launchId: string;
}): Promise<string | null> {
  const raw = input.tokenImageUrl?.trim();
  if (!raw) return null;

  if (raw.startsWith("/uploads/")) {
    const filePath = resolveUploadedFilePath(raw);
    if (filePath) {
      const bytes = await readFile(filePath);
      const ext = extname(filePath).replace(/^\./, "") || "png";
      const uploaded = await addBytesToKubo({
        bytes: new Uint8Array(bytes),
        filename: `${input.launchId}-token-image.${ext}`,
        contentType: contentTypeFromPath(filePath),
        pin: true,
      });
      return uploaded.gatewayUrl;
    }
  }

  const publicUrl = resolveUploadPublicUrl(raw);
  if (publicUrl && isPublicMetadataImageUrl(publicUrl)) {
    return publicUrl;
  }

  throw new Error(
    "Token image must be uploaded before publishing metadata. Upload a PNG, JPEG, or WebP on the launch form.",
  );
}
