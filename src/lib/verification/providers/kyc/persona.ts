import { createHmac, timingSafeEqual } from "node:crypto";
import {
  getPersonaApiKey,
  getPersonaApiVersion,
  getPersonaTemplateId,
  getPersonaWebhookSecret,
  isPersonaConfigured,
} from "@/lib/verification/config";
import type { KycProvider, KycSessionStatus } from "../types";

export class PersonaResumeConflictError extends Error {
  constructor(detail?: string) {
    super(detail?.trim() || "Conflict");
    this.name = "PersonaResumeConflictError";
  }
}

const PERSONA_API_BASE = "https://api.withpersona.com/api/v1";

type PersonaInquiryAttributes = {
  status?: string;
  "reference-id"?: string;
  "completed-at"?: string;
};

type PersonaWebhookPayload = {
  data?: {
    id?: string;
    type?: string;
    attributes?: {
      name?: string;
      payload?: {
        data?: {
          id?: string;
          type?: string;
          attributes?: PersonaInquiryAttributes;
        };
      };
    };
  };
};

function mapPersonaInquiryStatus(status: string | undefined): KycSessionStatus {
  const normalized = (status ?? "").toLowerCase();
  if (normalized === "approved" || normalized === "completed") return "approved";
  if (normalized === "declined" || normalized === "failed") return "rejected";
  if (normalized === "expired") return "expired";
  return "pending";
}

function mapPersonaEventToStatus(eventName: string | undefined): KycSessionStatus {
  switch (eventName) {
    case "inquiry.approved":
      return "approved";
    case "inquiry.declined":
    case "inquiry.failed":
      return "rejected";
    case "inquiry.expired":
      return "expired";
    case "inquiry.needs-review":
    case "inquiry.marked-for-review":
    case "inquiry.completed":
      return "pending";
    default:
      return "pending";
  }
}

export class PersonaKycProvider implements KycProvider {
  readonly name = "persona";

  async createSession(params: {
    referenceId: string;
    callbackUrl: string;
  }): Promise<{ sessionId: string; url: string }> {
    if (!isPersonaConfigured()) {
      throw new Error(
        "Persona is not configured — set PERSONA_API_KEY and PERSONA_TEMPLATE_ID.",
      );
    }

    const response = await fetch(`${PERSONA_API_BASE}/inquiries`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getPersonaApiKey()}`,
        "Content-Type": "application/json",
        "Persona-Version": getPersonaApiVersion(),
        "Key-Inflection": "camel",
      },
      body: JSON.stringify({
        data: {
          attributes: {
            "inquiry-template-id": getPersonaTemplateId(),
            "reference-id": params.referenceId,
            "redirect-uri": params.callbackUrl,
          },
        },
      }),
    });

    const body = (await response.json()) as {
      data?: { id?: string };
      errors?: Array<{ title?: string }>;
    };

    if (!response.ok) {
      const detail = body.errors?.[0]?.title ?? response.statusText;
      throw new Error(`Persona inquiry creation failed: ${detail}`);
    }

    const inquiryId = body.data?.id;
    if (!inquiryId) {
      throw new Error("Persona inquiry creation returned no inquiry id");
    }

    const hostedUrl = `https://withpersona.com/verify?inquiry-id=${encodeURIComponent(inquiryId)}`;

    return { sessionId: inquiryId, url: hostedUrl };
  }

  async createResumeSessionToken(inquiryId: string): Promise<string | null> {
    if (!isPersonaConfigured()) {
      throw new Error("Persona is not configured");
    }

    const response = await fetch(`${PERSONA_API_BASE}/inquiries/${inquiryId}/resume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getPersonaApiKey()}`,
        "Content-Type": "application/json",
        "Persona-Version": getPersonaApiVersion(),
        "Key-Inflection": "camel",
      },
      body: JSON.stringify({ meta: {} }),
    });

    const body = (await response.json()) as {
      meta?: { sessionToken?: string; "session-token"?: string };
      errors?: Array<{ title?: string }>;
    };

    if (!response.ok) {
      const detail = body.errors?.[0]?.title ?? response.statusText;
      if (response.status === 409) {
        throw new PersonaResumeConflictError(detail);
      }
      throw new Error(`Persona resume session failed: ${detail}`);
    }

    return body.meta?.sessionToken ?? body.meta?.["session-token"] ?? null;
  }

  async getStatus(sessionId: string): Promise<{
    status: KycSessionStatus;
    providerRef: string;
    completedAt?: Date;
  }> {
    if (!isPersonaConfigured()) {
      throw new Error("Persona is not configured");
    }

    const response = await fetch(`${PERSONA_API_BASE}/inquiries/${sessionId}`, {
      headers: {
        Authorization: `Bearer ${getPersonaApiKey()}`,
        "Persona-Version": getPersonaApiVersion(),
        "Key-Inflection": "camel",
      },
    });

    const body = (await response.json()) as {
      data?: { id?: string; attributes?: PersonaInquiryAttributes };
    };

    if (!response.ok || !body.data?.id) {
      return { status: "expired", providerRef: sessionId };
    }

    const attrs = body.data.attributes;
    const status = mapPersonaInquiryStatus(attrs?.status);
    const completedAt = attrs?.["completed-at"]
      ? new Date(attrs["completed-at"])
      : undefined;

    return {
      status,
      providerRef: body.data.id,
      completedAt,
    };
  }

  verifyWebhook(payload: unknown, signatureHeader: string): boolean {
    const secret = getPersonaWebhookSecret();
    if (!secret) return true;
    if (!signatureHeader.trim()) return false;

    const raw =
      typeof payload === "string" ? payload : JSON.stringify(payload ?? {});

    // Persona-Signature: t=<unix>,v1=<hex>  (space-separated when secrets rotate)
    for (const set of signatureHeader.trim().split(/\s+/)) {
      const parts: Record<string, string> = {};
      for (const pair of set.split(",")) {
        const eq = pair.indexOf("=");
        if (eq === -1) continue;
        parts[pair.slice(0, eq)] = pair.slice(eq + 1);
      }

      const timestamp = parts.t;
      const v1 = parts.v1;
      if (!timestamp || !v1) continue;

      const expected = createHmac("sha256", secret)
        .update(`${timestamp}.${raw}`)
        .digest("hex");

      try {
        const sigBuffer = Buffer.from(v1, "hex");
        const expectedBuffer = Buffer.from(expected, "hex");
        if (
          sigBuffer.length === expectedBuffer.length &&
          timingSafeEqual(sigBuffer, expectedBuffer)
        ) {
          return true;
        }
      } catch {
        if (v1 === expected) return true;
      }
    }

    return false;
  }

  parseWebhookEvent(payload: unknown): {
    eventId: string;
    eventName: string;
    inquiryId: string;
    referenceId: string | null;
    status: KycSessionStatus;
    needsReview: boolean;
  } | null {
    const body = payload as PersonaWebhookPayload;
    const eventId = body.data?.id;
    const eventName = body.data?.attributes?.name;
    const inquiry = body.data?.attributes?.payload?.data;
    const inquiryId = inquiry?.id;

    if (!eventId || !eventName || !inquiryId) return null;

    const inquiryStatus = inquiry?.attributes?.status;
    let status = mapPersonaEventToStatus(eventName);
    if (eventName === "inquiry.completed" && inquiryStatus === "approved") {
      status = "approved";
    }
    if (eventName === "inquiry.needs-review" || eventName === "inquiry.marked-for-review") {
      status = "pending";
    }

    return {
      eventId,
      eventName,
      inquiryId,
      referenceId: inquiry?.attributes?.["reference-id"] ?? null,
      status,
      needsReview:
        eventName === "inquiry.needs-review" ||
        eventName === "inquiry.marked-for-review",
    };
  }
}
