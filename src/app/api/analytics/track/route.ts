import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";

const TrackEventSchema = z.strictObject({
  event: z.enum([
    "page_view_advertise",
    "page_view_boost",
    "page_view_verify",
    "page_view_token_staking",
    "page_view_holder_perks",
    "stake_tx_confirmed",
  ]),
  path: z.string().trim().max(500).default(""),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBoundedJsonBody(request, TrackEventSchema, 8 * 1024);
    await prisma.conversionEvent.create({
      data: {
        eventType: body.event,
        path: body.path,
      },
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    }
    return new NextResponse(null, { status: 204 });
  }
}
