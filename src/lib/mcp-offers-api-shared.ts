export const MCP_OFFER_TITLE_MAX = 200;
export const MCP_OFFER_SUMMARY_MAX = 500;
export const MCP_OFFER_PRICE_MAX = 120;
export const MCP_OFFER_CTA_MAX = 500;
type McpOfferWithLink = {
  id: number;
  title: string;
  summary: string;
  priceLabel: string;
  ctaUrl: string;
  linkedServiceId: number | null;
  sortOrder: number;
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
  linkedService: { id: number; name: string; endpoint: string } | null;
};
export function serializeMcpOffer(o: McpOfferWithLink) {
  return {
    id: o.id,
    title: o.title,
    summary: o.summary,
    priceLabel: o.priceLabel,
    ctaUrl: o.ctaUrl,
    linkedServiceId: o.linkedServiceId,
    sortOrder: o.sortOrder,
    isPublished: o.isPublished,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    linkedService: o.linkedService,
  };
}