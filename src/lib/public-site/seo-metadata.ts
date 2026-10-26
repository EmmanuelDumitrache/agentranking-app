import type { Metadata } from "next";
import { getPublicSiteUrl } from "@/lib/site-url";
import {
  SITE_BRAND_NAME,
  SITE_TWITTER_HANDLE,
  hreflangLanguages,
} from "@/lib/seo-defaults";
import { publicSiteSocialOgImageUrl, socialOgImageMetadata } from "@/lib/social-og-images";
const PUBLIC_SITE = getPublicSiteUrl();
/**
 * Shared Open Graph / Twitter / canonical metadata for public-site index + detail pages.
 * Canonicals prefer the public site (agentranking.io).
 */
export function publicSitePageMetadata(opts: {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly imageUrl?: string | null;
  readonly noIndex?: boolean;
}): Metadata {
  const path = opts.path.startsWith("/") ? opts.path : `/${opts.path}`;
  const canonical = `${PUBLIC_SITE}${path}`;
  const fallbackImage = socialOgImageMetadata(publicSiteSocialOgImageUrl("home"), opts.title);
  const isGeneratedCard =
    opts.imageUrl?.includes("/og/social/") || opts.imageUrl?.includes("/api/og/");
  const image = opts.imageUrl
    ? {
        url: opts.imageUrl,
        alt: opts.title,
        ...(isGeneratedCard ? { width: 1200, height: 630 } : {}),
      }
    : fallbackImage;
  return {
    title: opts.title,
    description: opts.description,
    applicationName: SITE_BRAND_NAME,
    alternates: {
      canonical,
      languages: hreflangLanguages(canonical),
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: canonical,
      siteName: SITE_BRAND_NAME,
      title: opts.title,
      description: opts.description,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      site: SITE_TWITTER_HANDLE,
      creator: SITE_TWITTER_HANDLE,
      title: opts.title,
      description: opts.description,
      images: [image.url],
    },
    robots: opts.noIndex
      ? { index: false, follow: true }
      : { index: true, follow: true },
  };
}
