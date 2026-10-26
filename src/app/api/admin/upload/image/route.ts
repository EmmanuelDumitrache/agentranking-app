import {
  HttpBodyTooLargeError,
  MissingHttpContentLengthError,
  assertDeclaredHttpBodyWithinLimit,
} from "@/lib/bounded-http-body";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/admin-auth";
import { uploadFile } from "@/lib/upload";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ALLOWED_PREFIXES = new Set(["agent-images", "token-images"]);
/**
 * POST /api/admin/upload/image?prefix=agent-images|token-images
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const prefix = url.searchParams.get("prefix")?.trim() || "agent-images";
  if (!ALLOWED_PREFIXES.has(prefix)) {
    return NextResponse.json({ error: "Invalid upload prefix" }, { status: 400 });
  }
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
    const result = await uploadFile(file, file.type, { prefix });
    return NextResponse.json({ url: result.url, publicUrl: result.publicUrl, backend: result.backend });
  } catch (err) {
    console.error("[admin/upload/image]", err);
    const msg = Error.isError(err) ? err.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
