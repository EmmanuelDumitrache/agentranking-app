import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, parse, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  imageExtension,
  verifyUploadedImageType,
  type SupportedImageMimeType,
} from "@/lib/image-upload-validation";
import { resolveUploadPublicUrl } from "@/lib/public-media-url";
function uploadsRoot(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    return "/var/lib/agentranking/uploads";
  }

  // The App Router `/uploads/[...path]` route serves local files directly, so
  // development uploads do not need to live under `public/`. Keeping them
  // outside the repository also prevents Turbopack's NFT tracer from treating
  // a repository-root-derived filesystem path as a request to trace the project.
  return join(tmpdir(), "agentranking", "uploads");
}
export function getUploadsRoot(): string {
  return uploadsRoot();
}
/** Map `/uploads/<prefix>/<file>` to an absolute path under the uploads root. */
export function resolveUploadedFilePath(relativeUploadUrl: string): string | null {
  const trimmed = relativeUploadUrl.trim();
  if (!trimmed.startsWith("/uploads/")) return null;
  const relative = trimmed.slice("/uploads/".length);
  if (!relative || relative.includes("..")) return null;
  const segments = relative.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  if (segments.some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment))) return null;
  const absolute = resolve(join(/* turbopackIgnore: true */ uploadsRoot(), ...segments));
  const root = resolve(/* turbopackIgnore: true */ uploadsRoot());
  if (!absolute.startsWith(`${root}${sep}`) && absolute !== root) return null;
  return absolute;
}
export type UploadResult = {
  /** Stable relative URL stored in PostgreSQL. */
  url: string;
  /** Absolute URL for external consumers (launch metadata, previews). */
  publicUrl: string;
  /** MIME type verified from the uploaded bytes. */
  contentType: SupportedImageMimeType;
  /** Storage backend included in logs and API responses. */
  backend: "local";
};
export type UploadOptions = {
  fileName?: string;
  /** Single directory segment inside the persistent uploads root. */
  prefix: string;
  allowedImageTypes?: ReadonlySet<string>;
};
function safeSegment(value: string, field: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid ${field}`);
  return value;
}
/** Store a signature-verified image on persistent local disk; nginx serves /uploads/ directly. */
export async function uploadFile(
  file: File,
  declaredFileType: string,
  opts: UploadOptions,
): Promise<UploadResult> {
  if (file.type !== declaredFileType) throw new Error("Upload MIME type is inconsistent");
  const contentType = await verifyUploadedImageType(file, opts.allowedImageTypes);
  const prefix = safeSegment(opts.prefix, "upload prefix");
  const ext = imageExtension(contentType);
  const requestedName = opts.fileName
    ? `${parse(basename(opts.fileName)).name}.${ext}`
    : `${Date.now().toString(36)}-${randomUUID()}.${ext}`;
  const filename = requestedName.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!filename || filename === "." || filename === "..") throw new Error("Invalid upload filename");
  const dir = join(/* turbopackIgnore: true */ uploadsRoot(), prefix);
  await mkdir(/* turbopackIgnore: true */ dir, { recursive: true });
  const filePath = join(/* turbopackIgnore: true */ dir, filename);
  let created = false;
  try {
    // 0644 so nginx (www-data) can read files written by the Node app user.
    const output = createWriteStream(/* turbopackIgnore: true */ filePath, { flags: "wx", mode: 0o644 });
    output.once("open", () => { created = true; });
    await pipeline(Readable.fromWeb(file.stream() as never), output);
  } catch (error) {
    // Never remove a pre-existing file after an EEXIST collision. Clean up only an output
    // that this invocation successfully created before its stream failed, and preserve a
    // cleanup failure alongside the original write failure.
    if (created) {
      try {
        await rm(/* turbopackIgnore: true */ filePath, { force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Upload write and cleanup both failed for ${filePath}`,
        );
      }
    }
    throw error;
  }
  const relativeUrl = `/uploads/${prefix}/${filename}`;
  return {
    url: relativeUrl,
    publicUrl: resolveUploadPublicUrl(relativeUrl),
    contentType,
    backend: "local",
  };
}