import {
  AR_NEWS_XONA_A,
  AR_NEWS_XONA_B,
  splitNewsArticleMarkers,
} from "@/components/news/news-article-marker-split";
export type SplitXonaArticleHtmlResult = Readonly<{
  leadHtml: string;
  seekerMidHtml: string;
  tailHtml: string;
}>;
export function splitXonaArticleHtml(html: string): SplitXonaArticleHtmlResult | null {
  const r = splitNewsArticleMarkers(html, AR_NEWS_XONA_A, AR_NEWS_XONA_B);
  if (r == null) return null;
  return { leadHtml: r.leadHtml, seekerMidHtml: r.middleHtml, tailHtml: r.tailHtml };
}