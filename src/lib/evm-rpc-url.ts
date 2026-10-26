import { RPC_URLS } from "@/lib/erc8004-sync";
import { SEPOLIA_SERVER_RPC_URLS } from "@/lib/cors-rpc-urls";
function parseEnvKeyList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
}
function collectInfuraKeys(): string[] {
  const serverKeys = [
    process.env.INFURA_API_KEY,
    process.env.INFURA_API_KEY_2,
    process.env.INFURA_API_KEY_3,
    process.env.INFURA_API_KEY_4,
  ]
    .map((k) => k?.trim())
    .filter(Boolean) as string[];
  const browserKeys = parseEnvKeyList(process.env.NEXT_PUBLIC_INFURA_API_KEYS);
  const primaryBrowser = process.env.NEXT_PUBLIC_INFURA_API_KEY?.trim();
  if (primaryBrowser) browserKeys.push(primaryBrowser);
  return [...new Set([...serverKeys, ...browserKeys])];
}
const INFURA_KEYS = collectInfuraKeys();
/**
 * Ordered RPC URLs for receipt reads — tries each until one succeeds.
 * `https://rpc.sepolia.org` is deprecated/broken; use fallbacks like wagmi config.
 */
export function getEvmRpcUrls(chainId: number): string[] {
  const urls: string[] = [];
  const fromIndexer = RPC_URLS[chainId]?.trim();
  if (fromIndexer) urls.push(fromIndexer);
  if (chainId === 11155111) {
    const explicit =
      process.env.ETHEREUM_SEPOLIA_RPC_URL?.trim() ||
      process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL?.trim();
    if (explicit) urls.push(explicit);
    urls.push(...SEPOLIA_SERVER_RPC_URLS);
    for (const key of INFURA_KEYS) {
      urls.push(`https://sepolia.infura.io/v3/${key}`);
    }
  }
  if (chainId === 84532) {
    const explicit = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL?.trim();
    if (explicit) urls.push(explicit);
    for (const key of INFURA_KEYS) {
      urls.push(`https://base-sepolia.infura.io/v3/${key}`);
    }
    urls.push("https://sepolia.base.org");
  }
  return [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
}