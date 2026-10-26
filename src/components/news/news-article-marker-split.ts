/** Generic HTML splice for news embed slots — markers must match `articles.ts` exactly. */
export type SplitNewsArticleMarkersResult = Readonly<{
  leadHtml: string;
  middleHtml: string;
  tailHtml: string;
}>;
export const AR_NEWS_XONA_A = "<!--ar-news-xona-a-->";
export const AR_NEWS_XONA_B = "<!--ar-news-xona-b-->";
export const AR_NEWS_SYNAPSE_A = "<!--ar-news-synapse-a-->";
export const AR_NEWS_SYNAPSE_B = "<!--ar-news-synapse-b-->";
export function splitNewsArticleMarkers(
  html: string,
  markerA: string,
  markerB: string,
): SplitNewsArticleMarkersResult | null {
  const a = html.split(markerA);
  if (a.length !== 2) return null;
  const leadHtml = a[0].trimEnd();
  const b = a[1].split(markerB);
  if (b.length !== 2) return null;
  return {
    leadHtml,
    middleHtml: b[0].trim(),
    tailHtml: b[1].trim(),
  };
}