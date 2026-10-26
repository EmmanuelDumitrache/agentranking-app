export type ServiceProbeKind = "http" | "a2a_card" | "x402" | "not_probeable";
export function probeKindLabel(kind: ServiceProbeKind): string {
  switch (kind) {
    case "http":
      return "HTTP";
    case "a2a_card":
      return "A2A card";
    case "x402":
      return "x402";
    case "not_probeable":
      return "Not probeable";
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}
