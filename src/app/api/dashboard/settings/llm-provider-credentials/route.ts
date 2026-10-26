import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import { ensureAppAccountForProfile } from "@/lib/custodial-wallet/bootstrap";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { assertSameOriginMutation } from "@/lib/http-same-origin";
import {
  getProviderCredentialSettings,
  revokeProviderCredential,
  validateAndStoreProviderCredential,
} from "@/lib/llm-provider/credentials/service";
import { isProviderRuntimeFailure } from "@/lib/llm-provider/provider-failure";
import { ProviderCredentialConfigurationError } from "@/lib/llm-provider/credentials/crypto";

export const dynamic = "force-dynamic";

const credentialSchema = z.strictObject({
  provider: z.string().trim().min(1).max(64),
  secret: z.string().trim().min(1).max(16_384),
});
const revokeSchema = z.strictObject({
  provider: z.string().trim().min(1).max(64),
});

async function requireAccount() {
  const session = await getServerSession(authOptions);
  if (!hasDashboardSessionIdentity(session)) return null;
  const profile = await getDashboardUserProfile(session);
  if (!profile) return null;
  return ensureAppAccountForProfile({
    id: profile.id,
    displayName: profile.displayName,
    email: profile.email,
    avatarUrl: profile.avatarUrl,
  });
}

function providerErrorResponse(error: unknown): NextResponse {
  if (isProviderRuntimeFailure(error)) {
    const status = (() => {
      switch (error.kind) {
        case "authentication":
        case "model_not_found":
        case "request_invalid":
        case "content_policy":
          return 400;
        case "permission":
          return 403;
        case "billing":
          return 402;
        case "rate_limit":
        case "quota":
          return 429;
        case "cancelled":
          return 408;
        case "timeout":
        case "provider_unavailable":
        case "transport":
          return 503;
        case "unknown":
          return 502;
      }
    })();
    return NextResponse.json(
      {
        error: error.providerMessage ?? error.publicError.message,
        code: error.kind,
        retryable: error.retryable,
        retryAfterMs: error.retryAfterMs,
      },
      { status },
    );
  }
  if (error instanceof ProviderCredentialConfigurationError) {
    console.error("[llm-provider-credentials] credential storage configuration failed", {
      errorName: error.name,
      code: error.code,
      message: error.message,
    });
    return NextResponse.json(
      {
        error: "Provider credential storage is not configured correctly on this deployment",
        code: "credential_storage_unavailable",
        retryable: false,
      },
      { status: 503 },
    );
  }
  if (error instanceof Error && error.message.startsWith("Unsupported LLM provider credential:")) {
    return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  }
  if (error instanceof Error && (error as Error & { status?: number }).status === 403) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  console.error("[llm-provider-credentials] request failed", {
    errorName: error instanceof Error ? error.name : "unknown",
  });
  return NextResponse.json({ error: "Provider credential operation failed" }, { status: 500 });
}

export async function GET() {
  const account = await requireAccount();
  if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await getProviderCredentialSettings(account.id), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const account = await requireAccount();
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await parseBoundedJsonBody(request, credentialSchema, 64 * 1024);
    const credential = await validateAndStoreProviderCredential({
      appAccountId: account.id,
      provider: body.provider,
      secret: body.secret,
      signal: request.signal,
    });
    return NextResponse.json({ credential });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid credential request" }, { status: 400 });
    }
    return providerErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOriginMutation(request);
    const account = await requireAccount();
    if (!account) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await parseBoundedJsonBody(request, revokeSchema, 16 * 1024);
    await revokeProviderCredential(account.id, body.provider);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid revoke request" }, { status: 400 });
    }
    return providerErrorResponse(error);
  }
}
