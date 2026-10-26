const EVENT_LABELS: Record<string, string> = {
  view: "Profile view",
  search_impression: "Search impression",
  click_endpoint: "Link click",
  click_service: "Service click",
  click_x402: "x402 click",
  paid_service_view: "Paid service viewed",
  paid_service_click: "Paid service clicked",
  click_verify: "Verify click",
};
export function formatAnalyticsEventLabel(eventType: string): string {
  const key = eventType.trim().toLowerCase();
  if (EVENT_LABELS[key]) return EVENT_LABELS[key];
  return key.replaceAll("_", " ");
}
