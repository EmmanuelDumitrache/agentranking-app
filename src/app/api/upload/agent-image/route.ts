import {
  HttpBodyTooLargeError,
  MissingHttpContentLengthError,
  assertDeclaredHttpBodyWithinLimit,
} from "@/lib/bounded-http-body";
import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/upload";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import { normalizeStoredAgentImageUrl } from "@/lib/image-utils";
export const maxDuration = 30;
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
export async function POST(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  try {
    assertDeclaredHttpBodyWithinLimit(request, 6291456, { required: true });
  } catch (error) {
    if (error instanceof MissingHttpContentLengthError) {
      return NextResponse.json({ error: "Content-Length is required" }, { status: 411 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Upload body is too large" }, { status: 413 });
    }
    throw error;
  }
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Invalid file type. Use PNG, JPEG, WebP, or GIF." }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "File too large. Maximum size is 5MB." }, { status: 400 });
    }
    const result = await uploadFile(file, file.type, { prefix: "agent-images" });
    return NextResponse.json({
      url: normalizeStoredAgentImageUrl(result.url),
      publicUrl: result.publicUrl,
      path: result.url,
    });
  } catch (err) {
    console.error("Image upload error:", err);
    const msg = Error.isError(err) ? err.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
