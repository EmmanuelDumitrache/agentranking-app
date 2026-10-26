/** Quiverfun public site — Robinhood Chain launches indexed from factoryV3. */
export const QUIVERFUN_SITE_URL = "https://quiver.fun";

export function quiverfunTokenUrl(tokenAddress: string): string {
  const addr = tokenAddress.trim();
  if (!addr) return QUIVERFUN_SITE_URL;
  return `${QUIVERFUN_SITE_URL}/token/${addr}`;
}

export function quiverfunDiscoverUrl(): string {
  return QUIVERFUN_SITE_URL;
}
