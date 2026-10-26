export type MonetizationChecklistItem = {
  id: string;
  label: string;
  points: number;
  done: boolean;
  tip?: string;
};
export function computeMonetizationReadiness(input: {
  signals: Array<{ signalType: string; status: string }>;
  paidServiceCount: number;
  hasPricing: boolean;
  hasDocs: boolean;
}): { score: number; maxScore: number; items: MonetizationChecklistItem[] } {
  const has = (type: string, statuses: string[] = ["verified", "detected", "partner_registered"]) =>
    input.signals.some((s) => s.signalType === type && statuses.includes(s.status));
  const items: MonetizationChecklistItem[] = [
    { id: "x402", label: "Add x402 endpoint", points: 10, done: has("x402_detected") },
    { id: "x402_pay", label: "x402 payable signal", points: 8, done: has("x402_payable") },
    { id: "wallet", label: "Verify payment wallet", points: 8, done: has("payment_wallet_verified") },
    { id: "paid", label: "List a paid service", points: 6, done: input.paidServiceCount > 0 },
    { id: "pricing", label: "Add pricing", points: 6, done: input.hasPricing },
    { id: "mcp", label: "Connect MCP tool", points: 5, done: has("mcp_detected") || has("mcp_verified") },
    { id: "docs", label: "Add docs URL", points: 4, done: input.hasDocs },
    { id: "endpoint", label: "Endpoint live check", points: 4, done: has("endpoint_live", ["verified"]) },
  ];
  const maxScore = items.reduce((s, i) => s + i.points, 0);
  const score = items.filter((i) => i.done).reduce((s, i) => s + i.points, 0);
  return { score, maxScore, items };
}
