import type { X402ScanResult } from "@/lib/dashboard/x402-scanner";
import type { X402DisplayState } from "@/lib/dashboard/x402-display";
export type XPayAutofillTarget = {
  title: string;
  endpointUrl: string;
  priceUsd: string;
  priceLabel: string;
  paymentWallet: string;
};
export function x402DisplayStateFromScan(scan: X402ScanResult): X402DisplayState {
  const detected = scan.reachable || scan.statusCode === 402;
  const payable = scan.statusCode === 402 || scan.paymentHeaders.length > 0;
  return {
    detected,
    payable,
    httpStatus: scan.statusCode,
    endpoint: scan.endpoint,
    hints: scan.hints,
    paymentHeaders: scan.paymentHeaders,
    priceHint: scan.priceHint,
    assetHint: scan.assetHint,
    recipientHint: scan.recipientHint,
    lastScanned: new Date(),
    failureReason: detected ? null : scan.hints[0] ?? "Endpoint not reachable or no x402 signals found",
  };
}
function wordsFromSlug(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
function titleFromHost(hostname: string): string | null {
  const parts = hostname.replace(/^www\./, "").split(".");
  const brand = parts[0];
  if (!brand) return null;
  return `${wordsFromSlug(brand)} xPay service`;
}
function titleFromEndpoint(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const segment = pathParts.at(-1);
    const isDiscoveryUrl = pathParts.join("/") === ".well-known/x402";
    if (!segment || segment.toLowerCase() === "x402" || isDiscoveryUrl) {
      return titleFromHost(url.hostname);
    }
    return wordsFromSlug(segment);
  } catch {
    return null;
  }
}
function humanizeFilledField(field: string): string {
  if (field === "name") return "service name";
  if (field === "endpoint") return "endpoint URL";
  if (field === "price") return "price";
  if (field === "wallet") return "payment wallet";
  return field;
}
export function formatAutofillFields(filled: string[]): string {
  return filled.map(humanizeFilledField).join(", ");
}
function buildPriceLabel(scan: X402ScanResult): string | null {
  if (scan.priceHint && scan.assetHint) {
    return `${scan.priceHint} ${scan.assetHint} via xPay`;
  }
  if (scan.assetHint) return `${scan.assetHint} via xPay`;
  if (scan.priceHint) return `${scan.priceHint} USD via xPay`;
  return null;
}
export function applyX402ScanAutofill(
  target: XPayAutofillTarget,
  scan: X402ScanResult,
): { next: XPayAutofillTarget; filled: string[] } {
  const next = { ...target };
  const filled: string[] = [];
  if (scan.endpoint) {
    if (!next.endpointUrl.trim() || scan.endpoint !== next.endpointUrl.trim()) {
      next.endpointUrl = scan.endpoint;
      filled.push("endpoint");
    }
  }
  if (!next.title.trim()) {
    const derived = titleFromEndpoint(scan.endpoint);
    if (derived) {
      next.title = derived;
      filled.push("name");
    }
  }
  if (scan.priceHint && !next.priceUsd.trim()) {
    next.priceUsd = scan.priceHint;
    filled.push("price");
  }
  const priceLabel = buildPriceLabel(scan);
  if (priceLabel && !next.priceLabel.trim()) {
    next.priceLabel = priceLabel;
    if (!filled.includes("price")) filled.push("price");
  }
  if (scan.recipientHint && !next.paymentWallet.trim()) {
    next.paymentWallet = scan.recipientHint;
    filled.push("wallet");
  }
  return { next, filled };
}
export function x402ScanFeedback(
  scan: X402ScanResult,
  filled: string[],
): { message: string; type: "success" | "error" | "info" } {
  const autofillNote =
    filled.length > 0 ? ` Autofilled: ${formatAutofillFields(filled)}.` : "";
  if (!scan.reachable && scan.statusCode !== 402) {
    return {
      message: scan.hints[0] ?? "Could not reach that endpoint. Check the URL and try again.",
      type: "error",
    };
  }
  if (scan.statusCode === 402 || scan.paymentHeaders.length > 0) {
    const status = scan.statusCode != null ? `HTTP ${scan.statusCode}` : "payment headers found";
    return {
      message: `x402 payable (${status}).${autofillNote}`,
      type: "success",
    };
  }
  if (scan.reachable) {
    return {
      message: `Endpoint reachable, but no x402 payment signals were found.${autofillNote} You can still publish manually.`,
      type: "info",
    };
  }
  return { message: `Scan complete.${autofillNote}`, type: "info" };
}
