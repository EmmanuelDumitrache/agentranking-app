import { NextRequest, NextResponse } from "next/server";
import { getLaunchWalletSession } from "@/lib/launch-wallet-session/session";
import { uploadFile } from "@/lib/upload";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
export async function POST(request: NextRequest) {
  const limited = await rateLimitPublicApi(request, "standard");
  if (limited) return limited;
  const session = await getLaunchWalletSession();
  if (!session) {
    return NextResponse.json({ error: "Wallet session required" }, { status: 401 });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof File)) {
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
    const uploaded = await uploadFile(file, file.type, {
      prefix: "token-images",
    });
    return NextResponse.json({
      ok: true,
      url: uploaded.publicUrl,
      path: uploaded.url,
      contentType: uploaded.contentType,
    });
  } catch (error) {
    console.error("[public-token-image-upload]", error);
    return NextResponse.json({ error: "Image upload failed" }, { status: 500 });
  }
}
