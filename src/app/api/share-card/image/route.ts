import { NextRequest, NextResponse } from "next/server";
import { validateProbeUrl } from "@/lib/endpoint-probe-url";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_MS = 8_000;

/**
 * Same-origin image proxy for client-side share-card canvas exports.
 * Remote PFPs often lack CORS headers, so canvas `drawImage` / `toDataURL` fails —
 * this route fetches server-side and re-serves bytes from our origin.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url")?.trim() ?? "";
  const checked = validateProbeUrl(raw);
  if (!checked.ok) {
    return NextResponse.json({ error: checked.reason }, { status: 400 });
  }

  try {
    const response = await fetch(checked.url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_MS),
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif,image/svg+xml,*/*",
        "User-Agent": "AgentRanking-ShareCard/1.0",
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Upstream image failed" }, { status: 502 });
    }

    const contentType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Not an image" }, { status: 415 });
    }

    const declared = Number.parseInt(
      response.headers.get("content-length") ?? "0",
      10,
    );
    if (declared > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch image" }, { status: 502 });
  }
}
