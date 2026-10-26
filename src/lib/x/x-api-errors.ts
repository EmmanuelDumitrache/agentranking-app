export class XApiRateLimitError extends Error {
  readonly status = 429;
  readonly rateLimitedUntil: string;
  constructor(message: string, rateLimitedUntil: Date) {
    super(message);
    this.name = "XApiRateLimitError";
    this.rateLimitedUntil = rateLimitedUntil.toISOString();
  }
}
export function rateLimitedUntilFromResponse(res: Response): Date {
  const reset = res.headers.get("x-rate-limit-reset");
  if (reset) {
    const sec = Number.parseInt(reset, 10);
    if (Number.isFinite(sec) && sec > 0) {
      const ms = sec > 1e12 ? sec : sec * 1000;
      return new Date(ms);
    }
  }
  return new Date(Date.now() + 45 * 60 * 1000);
}