import { validateProbeUrl } from "@/lib/endpoint-probe-url";
import { requestPublicHttp } from "@/lib/outbound-http";
export type EndpointCheckResult = {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number;
  error?: string;
};
export async function probeEndpoint(url: string, signal?: AbortSignal): Promise<EndpointCheckResult> {
  const validated = validateProbeUrl(url);
  if (!validated.ok) {
    return { ok: false, statusCode: null, latencyMs: 0, error: validated.reason };
  }
  const started = Date.now();
  try {
    const res = await requestPublicHttp(validated.url.toString(), {
      method: "GET",
      signal,
      timeoutMs: 12_000,
      maxResponseBytes: 1,
      maxRedirects: 3,
      allowHttp: true,
      headers: { "User-Agent": "AgentRanking-Dashboard-Health/1.0" },
    });
    return {
      ok: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    return {
      ok: false,
      statusCode: null,
      latencyMs: Date.now() - started,
      error: Error.isError(err) ? err.message : "Probe failed",
    };
  }
}
