import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { loadDashboardSupportTickets } from "@/lib/dashboard/account-support.server";
import { ensureMinimalUserProfile, hasDashboardIdentity } from "@/lib/dashboard/session-profile";
export const dynamic = "force-dynamic";
const MAX_TICKETS_PER_DAY = 5;
function ticketEmailForProfile(profile: {
  id: number;
  email: string | null;
  walletAddress: string | null;
}): string {
  if (profile.email?.trim()) return profile.email.trim();
  if (profile.walletAddress?.trim()) {
    const w = profile.walletAddress.trim().toLowerCase();
    return `wallet+${w.replace(/^0x/, "").slice(0, 16)}@wallet.agentranking.io`;
  }
  return `user+${profile.id}@wallet.agentranking.io`;
}
export async function GET() {
  try {
    return NextResponse.json({ tickets: await loadDashboardSupportTickets() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load support tickets";
    return NextResponse.json({ error: message }, { status: message === "Unauthorized" ? 401 : 500 });
  }
}
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!hasDashboardIdentity(session)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json() as { subject: string; message: string };
    const subject = String(body.subject || "").trim().slice(0, 200);
    const message = String(body.message || "").trim().slice(0, 2000);
    if (!subject) return NextResponse.json({ error: "Subject is required." }, { status: 400 });
    if (message.length < 20) return NextResponse.json({ error: "Please provide more detail (at least 20 characters)." }, { status: 400 });
    const resolved = await ensureMinimalUserProfile(session);
    if (!resolved) {
      return NextResponse.json(
        {
          error:
            "We could not create or find your Agent Dashboard profile. Try signing out and back in, or verify an agent first.",
          code: "NO_PROFILE",
        },
        { status: 400 }
      );
    }
    const profile = await prisma.userProfile.findUnique({
      where: { id: resolved.id },
      select: { id: true, displayName: true, email: true, walletAddress: true },
    });
    if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentCount = await prisma.contactInquiry.count({
      where: { userId: profile.id, createdAt: { gte: since24h } },
    });
    if (recentCount >= MAX_TICKETS_PER_DAY) {
      return NextResponse.json({ error: "Too many tickets submitted today. Please try again tomorrow." }, { status: 429 });
    }
    const contactEmail = ticketEmailForProfile(profile);
    const ticket = await prisma.contactInquiry.create({
      data: {
        name: profile.displayName ?? contactEmail ?? "Dashboard User",
        email: contactEmail,
        subject,
        message,
        status: "open",
        userId: profile.id,
      },
    });
    return NextResponse.json({ ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, createdAt: ticket.createdAt } });
  } catch (err) {
    console.error("[api/dashboard/support] POST error:", err);
    return NextResponse.json({ error: "Failed to submit ticket." }, { status: 500 });
  }
}