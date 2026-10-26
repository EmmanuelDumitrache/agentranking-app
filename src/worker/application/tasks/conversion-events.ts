import type { ConversionEventPayload } from "@/jobs/contracts";
import { prisma } from "@/lib/db";
export async function trackConversionEventJob(payload: ConversionEventPayload) {
  const event = await prisma.conversionEvent.upsert({
    where: { idempotencyKey: payload.idempotencyKey },
    create: {
      idempotencyKey: payload.idempotencyKey,
      eventType: payload.eventType,
      path: payload.path,
      productType: payload.productType ?? undefined,
    },
    update: {},
    select: { id: true },
  });
  return { ok: true, eventId: event.id };
}
