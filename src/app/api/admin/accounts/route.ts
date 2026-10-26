import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/admin-auth";
import { isAdminIdentityAccessError } from "@/lib/admin/identity/auth.server";
import { readAdminAccountById, readAdminAccounts } from "@/lib/admin/identity/accounts.server";
import { normalizeAdminAccountsQuery } from "@/lib/admin/identity/query";
import { prisma } from "@/lib/db";
import { getJobProducer } from "@/jobs/boss";
import { NOTIFICATION_KINDS, queueNotificationInTx } from "@/lib/notification-delivery";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    const query = normalizeAdminAccountsQuery({
      page: request.nextUrl.searchParams.get("page"),
      perPage: request.nextUrl.searchParams.get("perPage"),
      search: request.nextUrl.searchParams.get("search"),
      status: request.nextUrl.searchParams.get("status"),
    });
    return NextResponse.json(await readAdminAccounts(query));
  } catch (error) {
    if (isAdminIdentityAccessError(error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[admin/accounts] GET error:", error);
    return NextResponse.json({ error: "Failed to load accounts." }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as {
      email: string;
      walletAddress?: string;
      displayName?: string;
      subscriptionStatus?: string;
      subscriptionPlan?: string;
      subscriptionExpiresAt?: string;
      adminNotes?: string;
      sendClaimEmail?: boolean;
    };
    if (!body.email) return NextResponse.json({ error: "Email required." }, { status: 400 });
    const email = body.email.trim().toLowerCase();
    const claimToken = randomUUID();
    const claimTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const existing = await prisma.userProfile.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Account with this email already exists." }, { status: 409 });
    }
    const shouldSendClaimEmail = body.sendClaimEmail !== false;
    if (shouldSendClaimEmail) await getJobProducer();
    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.userProfile.create({
        data: {
          email,
          walletAddress: body.walletAddress?.trim().toLowerCase() || null,
          displayName: body.displayName?.trim() || null,
          subscriptionStatus: body.subscriptionStatus ?? "pending",
          subscriptionPlan: body.subscriptionPlan ?? "",
          subscriptionExpiresAt: body.subscriptionExpiresAt ? new Date(body.subscriptionExpiresAt) : null,
          adminNotes: body.adminNotes ?? "",
          claimToken,
          claimTokenExpiresAt,
        },
      });
      if (shouldSendClaimEmail) {
        await queueNotificationInTx(tx, {
          idempotencyKey: `dashboard-claim:${created.id}:${claimToken}`,
          kind: NOTIFICATION_KINDS.DASHBOARD_CLAIM,
          recipient: email,
          payload: { profileId: created.id },
        });
      }
      return created;
    });
    const safeAccount = await readAdminAccountById(account.id);
    return NextResponse.json({ account: safeAccount });
  } catch (err) {
    console.error("[admin/accounts] POST error:", err);
    return NextResponse.json({ error: "Failed to create account." }, { status: 500 });
  }
}