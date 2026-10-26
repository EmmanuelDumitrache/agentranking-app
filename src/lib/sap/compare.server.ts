import "server-only";

import { getSapComparePair } from "@/lib/sap-ecosystem";
import {
  normalizeSapComparePda,
  probeX402Endpoint,
  type SapComparePayload,
} from "@/lib/sap-ecosystem-shared";

export type SapCompareReadResult =
  | { readonly ok: true; readonly data: SapComparePayload }
  | {
      readonly ok: false;
      readonly status: 400 | 404;
      readonly error: string;
      readonly found?: { readonly a: boolean; readonly b: boolean };
    };

export async function readSapComparison(
  rawA: string | null | undefined,
  rawB: string | null | undefined,
): Promise<SapCompareReadResult> {
  const a = normalizeSapComparePda(rawA);
  const b = normalizeSapComparePda(rawB);
  if (!a || !b) {
    return {
      ok: false,
      status: 400,
      error: "Query params a and b (SAP agent PDAs) are required",
    };
  }
  if (a === b) {
    return { ok: false, status: 400, error: "Choose two distinct agents" };
  }

  const pair = await getSapComparePair(a, b);
  if (!pair.a || !pair.b) {
    return {
      ok: false,
      status: 404,
      error: "One or both SAP agents not found",
      found: { a: Boolean(pair.a), b: Boolean(pair.b) },
    };
  }

  const [x402A, x402B] = await Promise.all([
    pair.a.sapX402Endpoint
      ? probeX402Endpoint(pair.a.sapX402Endpoint)
      : Promise.resolve("unknown" as const),
    pair.b.sapX402Endpoint
      ? probeX402Endpoint(pair.b.sapX402Endpoint)
      : Promise.resolve("unknown" as const),
  ]);

  return {
    ok: true,
    data: {
      a: pair.a,
      b: pair.b,
      x402Status: { a: x402A, b: x402B },
    },
  };
}
