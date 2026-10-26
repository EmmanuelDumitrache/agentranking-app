import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { resolveUploadedFilePath } from "@/lib/upload";

export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

type Props = { params: Promise<{ path: string[] }> };

export async function GET(_request: NextRequest, { params }: Props) {
  const { path } = await params;
  if (!path?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const relativeUrl = `/uploads/${path.join("/")}`;
  const filePath = resolveUploadedFilePath(relativeUrl);
  if (!filePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const bytes = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
