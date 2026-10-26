import { refreshX402DirectorySnapshot } from "@/lib/x402-market/external-directory";
export async function x402DirectoryRefreshJob() {
  const snapshot = await refreshX402DirectorySnapshot();
  return { rows: snapshot.rows.length, providerTotal: snapshot.providerTotal, fetchedAt: snapshot.fetchedAt };
}
