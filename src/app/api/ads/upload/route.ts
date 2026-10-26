import {
  HttpBodyTooLargeError,
  MissingHttpContentLengthError,
  assertDeclaredHttpBodyWithinLimit,
} from "@/lib/bounded-http-body";
import { NextRequest, NextResponse } from "next/server";
import { uploadFile } from "@/lib/upload";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const ALLOWED_TYPES = new Set(["image/gif", "image/png", "image/jpeg", "image/webp"]);
const MAX_SIZE_BYTES = 2 * 1024 * 1024; // 2MB
export async function POST(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  try {
    assertDeclaredHttpBodyWithinLimit(request, 3145728, { required: true });
  } catch (error) {
    if (error instanceof MissingHttpContentLengthError) {
      return NextResponse.json({ error: "Content-Length is required" }, { status: 411 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Upload body is too large" }, { status: 413 });
    }
    throw error;
  }
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file provided. Send as multipart/form-data field 'file'." },
      { status: 400 },
    );
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "File type not supported. Use GIF, PNG, JPG, or WebP." },
      { status: 400 },
    );
  }
  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 2MB." },
      { status: 400 },
    );
  }
  try {
    const result = await uploadFile(file, file.type, { prefix: "banners" });
    return NextResponse.json({ url: result.url });
  } catch (err) {
    const msg = Error.isError(err) ? err.message : "Upload failed";
    console.error("Banner upload error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
