import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isProSubscriber } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import { validateWebhookUrl } from "@/lib/webhook-url";
import {
  HttpBodyTooLargeError,
  readBoundedJsonBody,
} from "@/lib/bounded-http-body";
const SubscribeSchema = z.object({
  subscriberAgentId: z.number().int().positive(),
  publisherAgentId: z.number().int().positive(),
  webhookEndpoint: z.string().max(2_000).optional(),
  action: z.enum(["subscribe", "unsubscribe"]).default("subscribe"),
});
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    const profile = await ensureMinimalUserProfile(session);
    if (!profile) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    if (!isProSubscriber(profile)) {
      return NextResponse.json(
        { error: "Pro subscription required to use Agent Mesh." },
        { status: 403 },
      );
    }
    let body: unknown;
    try {
      body = await readBoundedJsonBody(req, 16 * 1024);
    } catch (error) {
      if (error instanceof HttpBodyTooLargeError) {
        return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = SubscribeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 422 });
    }
    const { subscriberAgentId, publisherAgentId, action } = parsed.data;
    const webhookEndpoint = parsed.data.webhookEndpoint?.trim();
    if (subscriberAgentId === publisherAgentId) {
      return NextResponse.json({ error: "An agent cannot subscribe to itself." }, { status: 422 });
    }
    const owned = await dashboardUserOwnsAgentDbId(
      profile.walletAddress ?? profile.solanaWallet,
      subscriberAgentId,
      profile.id,
    );
    if (!owned) {
      return NextResponse.json({ error: "subscriberAgentId is not an agent you operate" }, { status: 403 });
    }
    if (action === "unsubscribe") {
      await prisma.meshSubscription.updateMany({
        where: { subscriberAgentId, publisherAgentId },
        data: { isActive: false },
      });
      return NextResponse.json({ status: "unsubscribed" });
    }
    const publisher = await prisma.agent.findUnique({
      where: { id: publisherAgentId },
      select: { id: true, isActive: true },
    });
    if (!publisher?.isActive) {
      return NextResponse.json({ error: "Publisher agent not found or inactive" }, { status: 404 });
    }
    if (webhookEndpoint && !validateWebhookUrl(webhookEndpoint).ok) {
      return NextResponse.json(
        { error: "webhookEndpoint must be a public HTTPS URL" },
        { status: 422 },
      );
    }
    const sub = await prisma.meshSubscription.upsert({
      where: { subscriberAgentId_publisherAgentId: { subscriberAgentId, publisherAgentId } },
      update: {
        isActive: true,
        ...(webhookEndpoint !== undefined ? { webhookEndpoint } : {}),
      },
      create: {
        subscriberAgentId,
        publisherAgentId,
        webhookEndpoint: webhookEndpoint ?? "",
        isActive: true,
      },
    });
    return NextResponse.json({ id: sub.id, status: "subscribed" }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/mesh/subscribe]", err);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}
