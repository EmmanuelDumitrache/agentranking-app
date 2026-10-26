import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  HttpBodyTooLargeError,
  InvalidHttpBodyEncodingError,
  InvalidJsonBodyError,
  parseBoundedJsonBody,
} from "@/lib/bounded-http-body";

const ContactRequestSchema = z.strictObject({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Valid email is required").max(255),
  message: z.string().trim().min(1, "Message is required").max(5000),
});

export async function POST(request: NextRequest) {
  try {
    const body = await parseBoundedJsonBody(
      request,
      ContactRequestSchema,
      16 * 1024,
    );
    await prisma.contactInquiry.create({
      data: {
        name: body.name,
        email: body.email,
        message: body.message,
      },
    });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Invalid contact submission" }, { status: 400 });
    }
    if (error instanceof HttpBodyTooLargeError) {
      return NextResponse.json({ error: "Request body is too large" }, { status: 413 });
    }
    if (
      error instanceof InvalidJsonBodyError ||
      error instanceof InvalidHttpBodyEncodingError
    ) {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
  }
}
