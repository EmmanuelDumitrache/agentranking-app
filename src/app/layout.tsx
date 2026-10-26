import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppRuntimeBoundary } from "@/components/layout/core-providers";
import { DemoModeRuntime } from "@/components/demo/demo-mode-runtime";
import { isDemoMode } from "@/lib/demo-mode";
import { absoluteUrl, getPublicSiteUrl, getMetadataBase } from "@/lib/site-url";
import {
  HOME_PAGE_DESCRIPTION,
  HOME_PAGE_TITLE,
  SITE_BRAND_NAME,
  SITE_TWITTER_HANDLE,
  hreflangLanguages,
  siteIconUrl,
} from "@/lib/seo-defaults";
import { AGENTRANKING_THEME_INIT_SCRIPT } from "@/lib/agentranking-theme";
import { appSocialOgImageUrl, socialOgImageMetadata } from "@/lib/social-og-images";
const satoshi = localFont({
  src: "../../public/fonts/satoshi/Satoshi-Variable.woff2",
  variable: "--font-satoshi",
  display: "swap",
  weight: "300 900",
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});
const defaultOg = socialOgImageMetadata(appSocialOgImageUrl("home"), HOME_PAGE_TITLE);
export const metadata: Metadata = {
  metadataBase: getMetadataBase(),
  title: HOME_PAGE_TITLE,
  description: HOME_PAGE_DESCRIPTION,
  applicationName: SITE_BRAND_NAME,
  openGraph: {
    type: "website",
    locale: "en_US",
    title: HOME_PAGE_TITLE,
    description: HOME_PAGE_DESCRIPTION,
    siteName: SITE_BRAND_NAME,
    url: absoluteUrl("/"),
    images: [defaultOg],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  twitter: {
    card: "summary_large_image",
    site: SITE_TWITTER_HANDLE,
    creator: SITE_TWITTER_HANDLE,
    title: HOME_PAGE_TITLE,
    description: HOME_PAGE_DESCRIPTION,
    images: [defaultOg.url],
  },
  icons: {
    icon: [
      { url: siteIconUrl("/icon.png"), sizes: "48x48", type: "image/png" },
      { url: siteIconUrl("/icon-192.png"), sizes: "192x192", type: "image/png" },
    ],
    shortcut: siteIconUrl("/favicon.ico"),
    apple: [{ url: siteIconUrl("/apple-icon.png"), sizes: "180x180", type: "image/png" }],
  },
  alternates: {
    canonical: absoluteUrl("/"),
    languages: hreflangLanguages(absoluteUrl("/")),
  },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
  colorScheme: "dark light",
};
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="agentranking-app dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: AGENTRANKING_THEME_INIT_SCRIPT }} />
        <link
          rel="alternate"
          type="application/rss+xml"
          href={`${getPublicSiteUrl()}/feed.xml`}
          title="AgentRanking News"
        />
      </head>
      <body className={`${satoshi.variable} ${geistMono.variable}`}>
        <AppRuntimeBoundary>{children}</AppRuntimeBoundary>
        {isDemoMode() ? <DemoModeRuntime /> : null}
      </body>
    </html>
  );
}