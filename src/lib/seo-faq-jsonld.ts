import "server-only";
export type FaqItem = { question: string; answer: string };
/** Schema.org FAQPage payload for JSON-LD script tags. */
export function buildFaqPageStructuredData(items: FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}