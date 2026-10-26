import {
  HttpBodyTooLargeError,
  MissingHttpContentLengthError,
  assertDeclaredHttpBodyWithinLimit,
} from "@/lib/bounded-http-body";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getDashboardAccess } from "@/lib/dashboard/access";
import { uploadFile } from "@/lib/upload";
export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const agentIdParam = url.searchParams.get("agentId");
  if (agentIdParam) {
    const access = await getDashboardAccess(session);
    const agentId = Number.parseInt(agentIdParam, 10);
    if (!Number.isFinite(agentId)) {
      return NextResponse.json({ error: "Invalid agentId" }, { status: 400 });
    }
    if (!access.ownedAgents.some((a) => a.id === agentId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "File must be PNG, JPEG, or WebP" }, { status: 400 });
  }
  try {
    const result = await uploadFile(file, file.type, { prefix: "token-images" });
    return NextResponse.json({ ok: true, url: result.publicUrl, path: result.url });
  } catch (error) {
    console.error("[token-image-upload]", error);
    return NextResponse.json({ error: "Image upload failed" }, { status: 500 });
  }
}
