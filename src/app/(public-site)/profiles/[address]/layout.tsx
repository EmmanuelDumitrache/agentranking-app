import type { Metadata } from "next";
import type { ReactNode } from "react";
import { absoluteUrl } from "@/lib/site-url";
import { defaultOgImageMetadata, hreflangLanguages, ROBOTS_NOINDEX_UTILITY } from "@/lib/seo-defaults";
type Props = { params: Promise<{ address: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { address } = await params;
  const short =
    address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  const canonical = absoluteUrl(`/profiles/${encodeURIComponent(address)}`);
  const title = `Profile ${short} | AgentRanking`;
  const description = `Public profile on AgentRanking for ${short}. Explore linked wallets and on-chain AI agent directory activity.`;
  const og = defaultOgImageMetadata();
  return {
    title,
    description,
    robots: ROBOTS_NOINDEX_UTILITY,
    alternates: {
      canonical,
      languages: hreflangLanguages(canonical),
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: canonical,
      siteName: "AgentRanking",
      images: [{ ...og, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [og.url],
    },
  };
}
export default function ProfileLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
