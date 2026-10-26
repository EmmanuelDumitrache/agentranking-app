export const PERPSO_BASE_URL = "https://perp.so";
export const PERPSO_LEADERBOARD_PAGE_SIZE = 25;

export function perpsoWalletProfileUrl(wallet: string): string {
  return `${PERPSO_BASE_URL}/wallet/${wallet}`;
}
