export function parseStrictUnsignedInteger(
  value: unknown,
  label: string,
  options: { allowZero?: boolean; maximum?: number } = {},
): number {
  const token = typeof value === "number" ? String(value) : String(value ?? "").trim();
  const pattern = options.allowZero ? /^(?:0|[1-9][0-9]*)$/ : /^[1-9][0-9]*$/;
  if (!pattern.test(token)) throw new Error(`${label} must be a complete unsigned decimal integer`);
  const parsed = Number(token);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds JavaScript safe-integer range`);
  if (options.maximum != null && parsed > options.maximum) throw new Error(`${label} exceeds maximum ${options.maximum}`);
  return parsed;
}
export function parseOptionalStrictUnsignedInteger(
  value: unknown,
  label: string,
  fallback: number,
  options: { allowZero?: boolean; maximum?: number } = {},
): number {
  if (value == null || String(value).trim() === "") return fallback;
  return parseStrictUnsignedInteger(value, label, options);
}
/** Strict HTTP Content-Length parser. Missing headers are allowed; malformed values are not. */
export function parseOptionalContentLength(value: string | null | undefined, label = "Content-Length"): number | null {
  if (value == null || value === "") return null;
  return parseStrictUnsignedInteger(value, label, { allowZero: true, maximum: Number.MAX_SAFE_INTEGER });
}
