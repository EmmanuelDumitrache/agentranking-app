import type { Metadata } from "next";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, SITE_BRAND_NAME, SITE_TWITTER_HANDLE } from "@/lib/seo-defaults";
export type SeoMetadataInput = {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly ogImagePath?: string;
  readonly ogTitle?: string;
  readonly ogDescription?: string;
  readonly robots?: Metadata["robots"];
  readonly openGraphType?: "website" | "article";
};
const LOCALHOST_HOST_RE = /localhost|127\.0\.0\.1/i;
/** Production metadata must never canonicalize to localhost. */
export function seoCanonicalUrl(path: string): string {
  const url = absoluteUrl(path);
  if (process.env.NODE_ENV !== "production") return url;
  try {
    const { hostname } = new URL(url);
    if (LOCALHOST_HOST_RE.test(hostname)) {
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      return `https://app.agentranking.io${normalizedPath}`;
    }
  } catch {
    // fall through
  }
  return url;
}
export function buildSeoMetadata(input: SeoMetadataInput): Metadata {
  const canonical = seoCanonicalUrl(input.path);
  const ogTitle = input.ogTitle ?? input.title;
  const ogDescription = input.ogDescription ?? input.description;
  const ogPath = input.ogImagePath ?? "/og-default.png";
  const og = defaultOgImageMetadata();
  const ogUrl = seoCanonicalUrl(ogPath);
  const ogImage = {
    url: ogUrl,
    width: og.width,
    height: og.height,
    alt: ogTitle,
  };
  return {
    title: input.title,
    description: input.description,
    robots: input.robots,
    alternates: {
      canonical,
      languages: hreflangLanguages(canonical),
    },
    openGraph: {
      type: input.openGraphType ?? "website",
      title: ogTitle,
      description: ogDescription,
      url: canonical,
      siteName: SITE_BRAND_NAME,
      images: [ogImage],
    },
    twitter: {
      card: "summary_large_image",
      site: SITE_TWITTER_HANDLE,
      creator: SITE_TWITTER_HANDLE,
      title: ogTitle,
      description: ogDescription,
      images: [ogUrl],
    },
  };
}