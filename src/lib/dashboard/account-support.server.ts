import "server-only";
import type { Session } from "next-auth";
import { prisma } from "@/lib/db";
import { getDashboardUserProfile } from "@/lib/dashboard/session-profile";
import { hasDashboardSessionIdentity } from "@/lib/dashboard/session-identity";
import { getCachedDashboardSession } from "@/lib/dashboard/server-request";
export type DashboardSupportReplyDto = {
  id: number;
  body: string;
  createdAt: string;
  authorRole: string;
  readByUser: boolean;
};
export type DashboardSupportTicketDto = {
  id: number;
  subject: string;
  message: string;
  status: string;
  createdAt: string;
  replies: DashboardSupportReplyDto[];
};
async function resolveProfileId(session?: Session | null): Promise<number | null> {
  const resolved = session === undefined ? await getCachedDashboardSession() : session;
  if (!hasDashboardSessionIdentity(resolved) || resolved?.user?.mfaVerified === false) {
    throw new Error("Unauthorized");
  }
  return (await getDashboardUserProfile(resolved))?.id ?? null;
}
export async function loadDashboardSupportTickets(
  session?: Session | null,
): Promise<DashboardSupportTicketDto[]> {
  const profileId = await resolveProfileId(session);
  if (profileId == null) return [];
  const tickets = await prisma.contactInquiry.findMany({
    where: { userId: profileId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      subject: true,
      message: true,
      status: true,
      createdAt: true,
      replies: {
        orderBy: { createdAt: "asc" },
        select: { id: true, body: true, createdAt: true, authorRole: true, readByUser: true },
      },
    },
  });
  return tickets.map((ticket) => ({
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
    replies: ticket.replies.map((reply) => ({
      ...reply,
      createdAt: reply.createdAt.toISOString(),
    })),
  }));
}
export async function loadDashboardSupportUnreadCount(
  session?: Session | null,
): Promise<number> {
  const profileId = await resolveProfileId(session);
  if (profileId == null) return 0;
  return prisma.contactInquiryReply.count({
    where: {
      inquiry: { userId: profileId },
      authorRole: "admin",
      readByUser: false,
    },
  });
}
