export const SUPPORTED_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export type SupportedImageMimeType = (typeof SUPPORTED_IMAGE_MIME_TYPES)[number];
const SUPPORTED_IMAGE_MIME_SET = new Set<string>(SUPPORTED_IMAGE_MIME_TYPES);
export function isSupportedImageMimeType(value: string): value is SupportedImageMimeType {
  return SUPPORTED_IMAGE_MIME_SET.has(value);
}
function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
/** Detects image type from stable file signatures rather than caller-controlled MIME metadata. */
export function detectImageMimeType(bytes: Uint8Array): SupportedImageMimeType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 12) === "WEBP"
  ) return "image/webp";
  if (bytes.length >= 6) {
    const signature = ascii(bytes, 0, 6);
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
  }
  return null;
}
export function imageExtension(contentType: SupportedImageMimeType): "png" | "jpg" | "webp" | "gif" {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "png";
}
const MAX_SAFE_IMAGE_FILE_STEM_LENGTH = 96;
const MAX_IMAGE_FILE_NAME_INPUT_LENGTH = 512;
/**
 * Produces a bounded metadata filename for remote image uploaders.
 *
 * The caller-controlled name is display metadata, not a storage path. Strip
 * every path component and extension, then derive the extension exclusively
 * from the signature-verified MIME type. Normalizing before path splitting
 * also prevents full-width slash variants from surviving as pseudo-paths.
 */
export function safeImageFileName(
  fileName: string,
  contentType: SupportedImageMimeType,
): string {
  const normalized = fileName
    .slice(-MAX_IMAGE_FILE_NAME_INPUT_LENGTH)
    .normalize("NFKC")
    .replace(/\\/g, "/");
  const leaf = normalized.split("/").pop() ?? "";
  const finalDot = leaf.lastIndexOf(".");
  const rawStem = finalDot > 0 ? leaf.slice(0, finalDot) : leaf;
  const stem = rawStem
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, MAX_SAFE_IMAGE_FILE_STEM_LENGTH)
    .replace(/[._-]+$/g, "");
  return `${stem || "token-image"}.${imageExtension(contentType)}`;
}
export function assertImageBytesMatchDeclaredType(
  bytes: Uint8Array,
  declaredType: string,
  allowedTypes: ReadonlySet<string> = SUPPORTED_IMAGE_MIME_SET,
): SupportedImageMimeType {
  if (!allowedTypes.has(declaredType) || !isSupportedImageMimeType(declaredType)) {
    throw new Error("Unsupported image type");
  }
  const detected = detectImageMimeType(bytes);
  if (!detected || detected !== declaredType) {
    throw new Error("Image contents do not match the declared image type");
  }
  return detected;
}
export async function verifyUploadedImageType(
  file: Pick<File, "type" | "slice">,
  allowedTypes: ReadonlySet<string> = SUPPORTED_IMAGE_MIME_SET,
): Promise<SupportedImageMimeType> {
  const signature = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  return assertImageBytesMatchDeclaredType(signature, file.type, allowedTypes);
}