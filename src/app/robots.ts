import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOWED_PATH_PREFIXES } from "@/lib/seo-robots-policy";
import { absoluteUrl, getPublicSiteUrl } from "@/lib/site-url";
/** Points crawlers at the sitemap index (`src/app/sitemap.xml/route.ts`), which lists every `/sitemap/{id}.xml` part. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "Google-Extended",
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: [...ROBOTS_DISALLOWED_PATH_PREFIXES],
      },
    ],
    sitemap: [absoluteUrl("/sitemap.xml"), `${getPublicSiteUrl()}/sitemap.xml`],
  };
}
