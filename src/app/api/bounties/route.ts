import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  readBoundedJsonBody,
} from "@/lib/bounded-http-body";
const PAGE_SIZE = 20;
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status") ?? undefined;
    const taskType = searchParams.get("taskType") ?? undefined;
    const minAmount = searchParams.get("minAmount") ? Number(searchParams.get("minAmount")) : undefined;
    const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
    const where: Record<string, unknown> = {};
    if (status && status !== "all") where.status = status;
    if (taskType && taskType !== "all") where.taskType = taskType;
    if (minAmount && minAmount > 0) where.usdcAmount = { gte: minAmount };
    const [bounties, total] = await Promise.all([
      prisma.bounty.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          claimedAgent: {
            select: { id: true, name: true, isVerified: true, isPremiumVerified: true },
          },
          _count: { select: { disputes: true } },
        },
      }),
      prisma.bounty.count({ where }),
    ]);
    return NextResponse.json({ bounties, total, page, pageSize: PAGE_SIZE }, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
    });
  } catch (err) {
    console.error("[GET /api/bounties]", err);
    return NextResponse.json({ error: "Failed to fetch bounties" }, { status: 500 });
  }
}
const PostBountySchema = z.object({
  title: z.string().min(5).max(200),
  description: z.string().min(20).max(5000),
  usdcAmount: z.number().positive().max(1_000_000),
  deadline: z.string().datetime(),
  taskType: z.string().default("other"),
  verificationCriteria: z.string().min(10).max(2000),
  contactInfo: z.string().min(3).max(200),
  posterEmail: z.string().email().optional().or(z.literal("")),
});
export async function POST(req: NextRequest) {
  try {
    const body = await readBoundedJsonBody(req, 16 * 1024);
    const parsed = PostBountySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const data = parsed.data;
    // Validate deadline is in the future
    if (new Date(data.deadline) <= new Date()) {
      return NextResponse.json({ error: "Deadline must be in the future" }, { status: 422 });
    }
    const bounty = await prisma.bounty.create({
      data: {
        title: data.title,
        description: data.description,
        usdcAmount: data.usdcAmount,
        deadline: new Date(data.deadline),
        taskType: data.taskType,
        verificationCriteria: data.verificationCriteria,
        contactInfo: data.contactInfo,
        posterWallet: /^0x[0-9a-fA-F]{40}$/.test(data.contactInfo) ? data.contactInfo : "",
        posterEmail: data.posterEmail ?? "",
        // TODO: Helio escrow — lock usdcAmount USDC on Base before publishing
        escrowTx: "",
        status: "open",
      },
    });
    return NextResponse.json({ id: bounty.id, status: "created" }, { status: 201 });
  } catch (err) {
    if (err instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    if (err instanceof InvalidJsonBodyError || err instanceof InvalidHttpBodyEncodingError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    console.error("[POST /api/bounties]", err);
    return NextResponse.json({ error: "Failed to create bounty" }, { status: 500 });
  }
}
