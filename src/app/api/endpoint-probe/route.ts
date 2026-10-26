import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateProbeUrl } from "@/lib/endpoint-probe-url";
import { requestPublicHttp } from "@/lib/outbound-http";
import { rateLimitPublicApi } from "@/lib/public-api-rate-limit";
import { HttpBodyTooLargeError, parseBoundedJsonBody } from "@/lib/bounded-http-body";
export const maxDuration = 15;
const PROBE_MS = 8_000;
export type ProbeStatus = "healthy" | "dead" | "unknown" | "unverifiable";

const EndpointProbeSchema = z.strictObject({
  url: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const limited = await rateLimitPublicApi(req, "probe");
    if (limited) return limited;
    let body: z.infer<typeof EndpointProbeSchema>;
    try {
      body = await parseBoundedJsonBody(req, EndpointProbeSchema, 16 * 1024);
    } catch (error) {
      return NextResponse.json(
        { status: "unverifiable" as const, message: "Invalid request body" },
        { status: error instanceof HttpBodyTooLargeError ? 413 : 400 },
      );
    }
    const raw = body.url;
    const checked = validateProbeUrl(raw);
    if (!checked.ok) {
      return NextResponse.json(
        { status: "unverifiable" as const, message: checked.reason },
        { status: 400 },
      );
    }
    const target = checked.url.toString();
    const started = Date.now();
    const tryRequest = (method: "HEAD" | "GET") =>
      requestPublicHttp(target, {
        method,
        signal: req.signal,
        timeoutMs: PROBE_MS,
        maxResponseBytes: method === "GET" ? 1 : 0,
        maxRedirects: 3,
        allowHttp: true,
        headers:
          method === "GET"
            ? { Range: "bytes=0-0", Accept: "*/*", "User-Agent": "AgentRanking-HealthProbe/1.0" }
            : { Accept: "*/*", "User-Agent": "AgentRanking-HealthProbe/1.0" },
      });
    let response;
    try {
      response = await tryRequest("HEAD");
      if (response.status === 405 || response.status === 501) {
        response = await tryRequest("GET");
      }
    } catch (error) {
      const message = Error.isError(error) ? error.message : String(error);
      const timeout = /timed out/i.test(message);
      return NextResponse.json({
        status: timeout ? "unknown" as ProbeStatus : "dead" as ProbeStatus,
        message: timeout ? "Request timed out" : message.slice(0, 200),
        latencyMs: Date.now() - started,
      });
    }
    const latencyMs = Date.now() - started;
    const code = response.status;
    if (code >= 200 && code < 300) {
      return NextResponse.json({
        status: "healthy" as ProbeStatus,
        httpStatus: code,
        latencyMs,
        message: `HTTP ${code}`,
      });
    }
    if (code >= 400) {
      return NextResponse.json({
        status: "dead" as ProbeStatus,
        httpStatus: code,
        latencyMs,
        message: `HTTP ${code}`,
      });
    }
    return NextResponse.json({
      status: "unknown" as ProbeStatus,
      httpStatus: code,
      latencyMs,
      message: `HTTP ${code}`,
    });
  } catch (error) {
    const message = Error.isError(error) ? error.message : "Probe failed";
    return NextResponse.json(
      { status: "unverifiable" as const, message: message.slice(0, 200) },
      { status: 500 },
    );
  }
}
