import { NextRequest, NextResponse } from "next/server";
import { buildSitemapRouteIds } from "@/lib/sitemap-chunks";

/**
 * Runtime-generated so production lists all live child sitemaps. Build-time generation
 * intentionally sees only id 0 because sitemap chunk counting is disabled during `next build`.
 * Served publicly as `/sitemap.xml` through the rewrite in next.config.ts.
 */
export const dynamic = "force-dynamic";
export const revalidate = 3600;

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sitemapLastModified(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  let ids: { id: number }[];
  try {
    ids = await buildSitemapRouteIds();
  } catch (error) {
    console.error("[api/sitemap-index] failed:", error);
    ids = [{ id: 0 }];
  }

  const origin = request.nextUrl.origin;
  const generatedAt = sitemapLastModified(new Date());
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${ids
  .map(
    ({ id }) => `  <sitemap>
    <loc>${escapeXml(`${origin}/sitemap/${id}.xml`)}</loc>
    <lastmod>${generatedAt}</lastmod>
  </sitemap>`,
  )
  .join("\n")}
</sitemapindex>
`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control":
        "public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
