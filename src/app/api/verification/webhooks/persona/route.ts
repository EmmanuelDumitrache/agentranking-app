import { NextResponse } from "next/server";
import { applyProviderVerificationStatus } from "@/lib/verification/account-verification-service";
import { getPersonaWebhookSecret } from "@/lib/verification/config";
import { PersonaKycProvider } from "@/lib/verification/providers/kyc/persona";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("persona-signature") ??
    request.headers.get("x-persona-signature") ??
    "";

  const provider = new PersonaKycProvider();

  if (getPersonaWebhookSecret() && !provider.verifyWebhook(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const event = provider.parseWebhookEvent(payload);
  if (!event) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  if (!event.referenceId) {
    return NextResponse.json({ error: "Missing reference id" }, { status: 400 });
  }

  if (
    event.eventName !== "inquiry.approved" &&
    event.eventName !== "inquiry.declined" &&
    event.eventName !== "inquiry.failed" &&
    event.eventName !== "inquiry.expired" &&
    event.eventName !== "inquiry.needs-review" &&
    event.eventName !== "inquiry.marked-for-review" &&
    event.eventName !== "inquiry.completed"
  ) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  await applyProviderVerificationStatus({
    appAccountId: event.referenceId,
    provider: provider.name,
    providerReference: event.inquiryId,
    providerSessionId: event.inquiryId,
    status: event.status,
    needsReview: event.needsReview,
    webhookEventId: event.eventId,
    verifiedAt: event.status === "approved" ? new Date() : undefined,
  });

  return NextResponse.json({ ok: true });
}
