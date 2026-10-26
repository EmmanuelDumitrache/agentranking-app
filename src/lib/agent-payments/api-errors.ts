import { Prisma } from "@/generated/prisma/client";

export function formatTreasuryMutationError(err: unknown, fallback: string): string {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2022") {
      return "Database schema is out of date. Run `pnpm db:migrate`, then restart the dev server.";
    }
  }

  const message = err instanceof Error ? err.message : fallback;
  if (message.includes("freezePinHash") && message.includes("Unknown arg")) {
    return "App database client is out of date. Restart `pnpm dev` to regenerate Prisma.";
  }
  if (message.includes("freeze_pin_hash") && message.includes("does not exist")) {
    return "Database migration required. Run `pnpm db:migrate`, then restart the dev server.";
  }
  if (message.startsWith("Invalid `") && message.includes("invocation")) {
    return fallback;
  }

  return message || fallback;
}
