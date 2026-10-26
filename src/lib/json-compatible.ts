/** JSON serialization that preserves integer precision by encoding bigint values as decimal strings. */
export function stringifyJsonCompatible(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? entry.toString(10) : entry,
  );
  if (serialized === undefined) {
    throw new TypeError("Value is not JSON serializable");
  }
  return serialized;
}

/**
 * Convert an in-memory value to the same JSON-safe shape that is stored in
 * PostgreSQL JSON columns, Valkey, and returned by HTTP JSON responses.
 */
export function toJsonCompatible<T>(value: T): T {
  return JSON.parse(stringifyJsonCompatible(value)) as T;
}
