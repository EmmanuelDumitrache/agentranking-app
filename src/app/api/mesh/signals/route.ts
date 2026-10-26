import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getJobProducer } from "@/jobs/boss";
import { enqueueApplicationJobInTx } from "@/jobs/producer";
import { JOB_QUEUES } from "@/jobs/queues";
import { isProSubscriber } from "@/lib/dashboard/access";
import { ensureMinimalUserProfile } from "@/lib/dashboard/session-profile";
import { dashboardUserOwnsAgentDbId } from "@/lib/dashboard/ownership-check";
import {
  HttpBodyTooLargeError,
  readBoundedJsonBody,
} from "@/lib/bounded-http-body";
const MAX_SIGNAL_PAYLOAD_BYTES = 64 * 1024;
export async function GET(req: NextRequest) {
  try {
    const publisherAgentId = Number.parseInt(req.nextUrl.searchParams.get("publisherAgentId") ?? "", 10);
    const requestedLimit = Number.parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);
    const limit = Number.isSafeInteger(requestedLimit)
      ? Math.max(1, Math.min(50, requestedLimit))
      : 20;
    if (!Number.isSafeInteger(publisherAgentId) || publisherAgentId <= 0) {
      return NextResponse.json({ error: "publisherAgentId is required" }, { status: 422 });
    }
    const signals = await prisma.meshSignal.findMany({
      where: { publisherAgentId },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
    return NextResponse.json(
      { signals },
      { headers: { "Cache-Control": "public, s-maxage=5" } },
    );
  } catch (err) {
    console.error("[GET /api/mesh/signals]", err);
    return NextResponse.json({ error: "Failed to fetch signals" }, { status: 500 });
  }
}
const PublishSchema = z.object({
  publisherAgentId: z.number().int().positive(),
  signalType: z.string().trim().min(1).max(50),
  payload: z.record(z.string(), z.unknown()),
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
        { error: "Pro subscription required to publish signals." },
        { status: 403 },
      );
    }
    let body: unknown;
    try {
      body = await readBoundedJsonBody(req, MAX_SIGNAL_PAYLOAD_BYTES + 16 * 1024);
    } catch (error) {
      if (error instanceof HttpBodyTooLargeError) {
        return NextResponse.json({ error: "Signal payload is too large" }, { status: 413 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = PublishSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 422 });
    }
    const { publisherAgentId, signalType, payload } = parsed.data;
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    if (payloadBytes > MAX_SIGNAL_PAYLOAD_BYTES) {
      return NextResponse.json({ error: "Signal payload is too large" }, { status: 413 });
    }
    const owned = await dashboardUserOwnsAgentDbId(
      profile.walletAddress ?? profile.solanaWallet,
      publisherAgentId,
      profile.id,
    );
    if (!owned) {
      return NextResponse.json(
        { error: "Agent not found or not operated by this account." },
        { status: 403 },
      );
    }
    await getJobProducer();
    const signal = await prisma.$transaction(async (tx) => {
      const created = await tx.meshSignal.create({
        data: {
          publisherAgentId,
          signalType,
          payload: payload as Prisma.InputJsonValue,
        },
      });
      await enqueueApplicationJobInTx(
        tx,
        JOB_QUEUES.MESH_SIGNAL_FANOUT,
        { v: 1, id: created.id },
        { singletonKey: created.id },
      );
      return created;
    });
    return NextResponse.json({ id: signal.id, status: "published" }, { status: 201 });
  } catch (err) {
    console.error("[POST /api/mesh/signals]", err);
    return NextResponse.json({ error: "Failed to publish signal" }, { status: 500 });
  }
}
