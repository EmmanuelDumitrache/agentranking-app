import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { invalidatePublicFeedbackStatistics } from "@/lib/invalidate-public-statistics";
import { normalizePublicFeedbackQuery } from "@/lib/agent-directory/feedback";
import { readPublicFeedbackApiPage } from "@/lib/agent-directory/feedback.server";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";
export const maxDuration = 60;

const FeedbackCreateSchema = z.strictObject({
  agentId: z.coerce.number().int().positive("agentId must be a positive integer"),
  clientAddress: z.string().trim().min(1, "clientAddress is required").max(255),
  value: z.coerce.number().min(1, "value must be between 1 and 5").max(5, "value must be between 1 and 5"),
  comment: z.string().trim().max(2000).optional(),
});

export async function GET(request: NextRequest) {
  const input = Object.fromEntries(request.nextUrl.searchParams.entries());
  return NextResponse.json(await readPublicFeedbackApiPage(normalizePublicFeedbackQuery(input)));
}
export async function POST(request: NextRequest) {
  try {
    const body = await parseBoundedJsonBody(request, FeedbackCreateSchema, 16 * 1024);
    const { agentId: agentIdNumber, clientAddress: address, value: starValue, comment } = body;
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`site-feedback:${agentIdNumber}:${address}`}, 0))`;
      const existing = await tx.feedback.findFirst({
        where: {
          agentId: agentIdNumber,
          clientAddress: address,
          feedbackIndex: null,
          sourceRegistry: null,
        },
        select: { id: true },
      });
      if (existing) return { duplicate: true as const };
      const feedback = await tx.feedback.create({
        data: {
          agentId: agentIdNumber,
          clientAddress: address,
          value: starValue,
          valueDecimals: 0,
          tag1: "",
          tag2: "",
          comment: comment ?? "",
        },
      });
      await tx.agent.update({
        where: { id: agentIdNumber },
        data: { totalFeedback: { increment: 1 } },
        select: { id: true },
      });
      return { duplicate: false as const, feedback };
    });
    if (result.duplicate) {
      return NextResponse.json({ error: "You have already submitted feedback for this agent" }, { status: 409 });
    }
    await invalidatePublicFeedbackStatistics();
    return NextResponse.json(result.feedback);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid feedback request" }, { status: 400 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    if (error instanceof InvalidJsonBodyError || error instanceof InvalidHttpBodyEncodingError) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    console.error("[POST /api/feedback]", error);
    return NextResponse.json({ error: "Failed to submit feedback" }, { status: 500 });
  }
}
