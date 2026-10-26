import { validatePublicHttpUrl } from "@/lib/outbound-http";

function localWebhookOptIn(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ALLOW_LOCAL_WEBHOOKS === "1";
}

export function validateWebhookUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  const allowLocalhost = localWebhookOptIn();
  return validatePublicHttpUrl(raw, {
    allowHttp: allowLocalhost,
    allowLocalhost,
    maxUrlLength: 2_000,
  });
}
