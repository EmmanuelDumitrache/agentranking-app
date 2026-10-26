import { Prisma } from "@/generated/prisma/client";

/**
 * Converts normalized decoder output into a Prisma JSON write value.
 *
 * Prisma intentionally distinguishes a database NULL from the JSON literal
 * null. Decoder fields use database NULL when no structured value exists, so
 * callers must not pass JavaScript null directly to a Json? column.
 */
export function prismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value == null) return Prisma.DbNull;
  const serialized = JSON.stringify(value, (_key, item) => {
    if (typeof item === "bigint") return item.toString(10);
    if (item instanceof Uint8Array) return `0x${Buffer.from(item).toString("hex")}`;
    return item;
  });
  if (serialized == null) return Prisma.DbNull;
  return JSON.parse(serialized) as Prisma.InputJsonValue;
}
