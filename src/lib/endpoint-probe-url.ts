import { validatePublicHttpUrl } from "@/lib/outbound-http";
export type ProbeUrlReject = { ok: false; reason: string };
/** Validate probe syntax. Actual requests re-resolve and pin public DNS in requestPublicHttp. */
export function validateProbeUrl(raw: string): { ok: true; url: URL } | ProbeUrlReject {
  return validatePublicHttpUrl(raw, { allowHttp: true, maxUrlLength: 2_048 });
}