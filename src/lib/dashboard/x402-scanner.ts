import { validateProbeUrl } from "@/lib/endpoint-probe-url";
import { requestPublicHttp } from "@/lib/outbound-http";
import type { DerivedSignal } from "@/lib/signals/types";
export type X402ScanResult = {
  endpoint: string;
  reachable: boolean;
  statusCode: number | null;
  hints: string[];
  paymentHeaders: string[];
  priceHint: string | null;
  assetHint: string | null;
  recipientHint: string | null;
};
function extractPaymentHints(headers: string[]): {
  priceHint: string | null;
  assetHint: string | null;
  recipientHint: string | null;
} {
  let priceHint: string | null = null;
  let assetHint: string | null = null;
  let recipientHint: string | null = null;
  for (const line of headers) {
    const lower = line.toLowerCase();
    const priceMatch = line.match(/amount[=:\s]+([0-9.]+)/i) ?? line.match(/\$([0-9.]+)/);
    if (priceMatch?.[1]) priceHint = priceMatch[1];
    const assetMatch = line.match(/(?:asset|currency|token)[=:\s]+([a-z0-9]+)/i);
    if (assetMatch?.[1]) assetHint = assetMatch[1];
    const recipientMatch =
      line.match(/(?:recipient|payee|wallet|address)[=:\s]+(0x[a-f0-9]{6,}|[1-9A-HJ-NP-Za-km-z]{20,})/i);
    if (recipientMatch?.[1]) recipientHint = recipientMatch[1];
    if (lower.includes("usdc")) assetHint = assetHint ?? "USDC";
    if (lower.includes("eth")) assetHint = assetHint ?? "ETH";
  }
  return { priceHint, assetHint, recipientHint };
}
export async function scanX402Endpoint(rawUrl: string, signal?: AbortSignal): Promise<X402ScanResult> {
  const validated = validateProbeUrl(rawUrl);
  if (!validated.ok) {
    return {
      endpoint: rawUrl,
      reachable: false,
      statusCode: null,
      hints: [validated.reason],
      paymentHeaders: [],
      priceHint: null,
      assetHint: null,
      recipientHint: null,
    };
  }
  const hints: string[] = [];
  const paymentHeaders: string[] = [];
  try {
    const res = await requestPublicHttp(validated.url.toString(), {
      method: "GET",
      signal,
      timeoutMs: 12_000,
      maxResponseBytes: 262_144,
      maxRedirects: 3,
      allowHttp: true,
      headers: { Accept: "application/json", "User-Agent": "AgentRanking-x402-Scanner/1.0" },
    });
    for (const [key, rawValue] of Object.entries(res.headers)) {
      const value = Array.isArray(rawValue) ? rawValue.join(", ") : rawValue;
      if (!value) continue;
      const lower = key.toLowerCase();
      if (lower.includes("payment") || lower.includes("x402") || lower.includes("www-authenticate")) {
        paymentHeaders.push(`${key}: ${value}`);
      }
    }
    if (res.status === 402) hints.push("HTTP 402 Payment Required detected");
    if (paymentHeaders.length > 0) hints.push("Payment-related headers found");
    const text = res.body;
    if (/x-?402|payment.?required|paywall/i.test(text)) {
      hints.push("x402/payment keywords in response body");
    }
    const paymentHints = extractPaymentHints(paymentHeaders);
    return {
      endpoint: validated.url.toString(),
      reachable: (res.status >= 200 && res.status < 300) || res.status === 402,
      statusCode: res.status,
      hints,
      paymentHeaders,
      ...paymentHints,
    };
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    return {
      endpoint: rawUrl,
      reachable: false,
      statusCode: null,
      hints: [Error.isError(err) ? err.message : "Scan failed"],
      paymentHeaders: [],
      priceHint: null,
      assetHint: null,
      recipientHint: null,
    };
  }
}
export function x402SignalsFromScan(result: X402ScanResult): DerivedSignal[] {
  const now = new Date();
  const signals: DerivedSignal[] = [
    {
      signalType: "x402_detected",
      status: result.reachable || result.statusCode === 402 ? "detected" : "failed",
      source: "x402",
      confidence: result.paymentHeaders.length > 0 ? "high" : "medium",
      value: result.endpoint,
      payloadJson: {
        statusCode: result.statusCode,
        hints: result.hints,
        paymentHeaders: result.paymentHeaders,
        priceHint: result.priceHint,
        assetHint: result.assetHint,
        recipientHint: result.recipientHint,
      },
      lastCheckedAt: now,
    },
  ];
  if (result.statusCode === 402 || result.paymentHeaders.length > 0) {
    signals.push({
      signalType: "x402_payable",
      status: "verified",
      source: "x402",
      confidence: "high",
      value: result.endpoint,
      payloadJson: { hints: result.hints },
      lastCheckedAt: now,
      verifiedAt: now,
    });
  }
  return signals;
}
