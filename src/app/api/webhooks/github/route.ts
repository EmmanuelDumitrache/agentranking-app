import { hash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  normalizeGithubWebhookEvent,
  verifyGithubWebhookSignature,
} from "@/lib/dashboard/github-sync";
import { githubWebhookPayloadSchema } from "@/jobs/contracts";
import { enqueueGithubWebhook } from "@/jobs/github-webhook";
export const dynamic = "force-dynamic";
const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;
async function readBodyBounded(request: NextRequest): Promise<Buffer> {
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    throw new RangeError("Webhook payload is too large");
  }
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new RangeError("Webhook payload is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}
export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
  let rawBytes: Buffer;
  try {
    rawBytes = await readBodyBounded(request);
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    return NextResponse.json({ error: "Could not read webhook body" }, { status: 400 });
  }
  let rawBody: string;
  try {
    rawBody = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
  } catch {
    return NextResponse.json({ error: "Webhook body must be valid UTF-8" }, { status: 400 });
  }
  const signature = request.headers.get("x-hub-signature-256");
  const event = request.headers.get("x-github-event") ?? "";
  if (!secret && process.env.NODE_ENV === "production") {
    console.error("[github-webhook] GITHUB_WEBHOOK_SECRET is required in production");
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }
  if (secret && !verifyGithubWebhookSignature(rawBytes, signature, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!event.trim()) {
    return NextResponse.json({ error: "Missing x-github-event header" }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    const parsedBody: unknown = JSON.parse(rawBody);
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return NextResponse.json({ error: "Webhook body must be a JSON object" }, { status: 400 });
    }
    body = parsedBody as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const payloadHash = hash("sha256", rawBytes, "hex");
  const deliveryId = request.headers.get("x-github-delivery")?.trim() || payloadHash;
  const normalized = normalizeGithubWebhookEvent(event, body);
  const parsed = githubWebhookPayloadSchema.safeParse({
    v: 1,
    deliveryId,
    payloadHash,
    ...normalized,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Unsupported webhook payload" }, { status: 400 });
  }
  try {
    const queued = await enqueueGithubWebhook(parsed.data);
    return NextResponse.json(
      { ok: true, event: parsed.data.event, deliveryId, ...queued },
      { status: 202 },
    );
  } catch (error) {
    console.error("[github-webhook] enqueue failed", { event, deliveryId, error });
    return NextResponse.json({ error: "Webhook enqueue failed" }, { status: 500 });
  }
}
