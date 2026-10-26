export type AgentPaymentRailInput = {
  readonly x402Support?: boolean | null;
  readonly mppSupport?: boolean | null;
  readonly declaredX402Support?: boolean | null;
  readonly declaredMppSupport?: boolean | null;
  readonly sapProtocols?: readonly string[] | null;
};

const MPP_PROTOCOL_TOKENS = new Set([
  "mpp",
  "machine-payments-protocol",
  "machine payments protocol",
  "payment",
  "payments",
]);

function normalizeProtocolToken(value: string): string {
  return value.trim().toLowerCase();
}

function protocolDeclaresMpp(protocols: readonly string[] | null | undefined): boolean {
  if (!protocols?.length) return false;
  return protocols.some((protocol) => {
    const normalized = normalizeProtocolToken(protocol);
    if (!normalized) return false;
    if (MPP_PROTOCOL_TOKENS.has(normalized)) return true;
    return normalized.includes("mpp") || normalized.includes("machine payment");
  });
}

/** True when registration JSON or SAP protocol tags declare MPP support. */
export function declaresMppSupport(input: {
  readonly mppSupport?: boolean | null;
  readonly protocols?: readonly string[] | null;
}): boolean {
  if (input.mppSupport === true) return true;
  return protocolDeclaresMpp(input.protocols);
}

/** Materialized payment-rail flags for Agent rows (declared registration + SAP tags). */
export function resolveAgentPaymentRails(input: AgentPaymentRailInput): {
  readonly x402Support: boolean;
  readonly mppSupport: boolean;
} {
  const x402Support =
    input.declaredX402Support != null
      ? input.declaredX402Support
      : Boolean(input.x402Support);

  const mppFromProtocols = protocolDeclaresMpp(input.sapProtocols);
  const mppSupport =
    input.declaredMppSupport != null
      ? input.declaredMppSupport || mppFromProtocols
      : Boolean(input.mppSupport) || mppFromProtocols;

  return {
    x402Support: Boolean(x402Support),
    mppSupport: Boolean(mppSupport),
  };
}
