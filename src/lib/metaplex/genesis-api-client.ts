import { z } from "zod";
import { parseBoundedJsonBody } from "@/lib/bounded-http-body";
import type { MetaplexGenesisEnrichment } from "@/lib/metaplex/types";

const GENESIS_API_BASE = "https://api.metaplex.com/v1";

const MetaplexGenesisLaunchWireSchema = z.object({
  launchPage: z.string().nullable().optional(),
  mechanic: z.string().nullable().optional(),
  genesisAddress: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  graduatedAt: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
});

export type MetaplexGenesisLaunchWire = z.infer<typeof MetaplexGenesisLaunchWireSchema>;

const MetaplexGenesisTokenWireSchema = z.object({
  launches: z.array(MetaplexGenesisLaunchWireSchema).optional(),
  baseToken: z.object({
    address: z.string().optional(),
    name: z.string().optional(),
    symbol: z.string().optional(),
  }).optional(),
});

export type MetaplexGenesisTokenWire = z.infer<typeof MetaplexGenesisTokenWireSchema>;

const GenesisApiResponseSchema = z.object({
  data: MetaplexGenesisTokenWireSchema.optional(),
});
export type GenesisTokenLookupResult =
  | { status: "ok"; data: MetaplexGenesisTokenWire }
  | { status: "not_found"; data: null }
  | { status: "error"; error: string };
function isBondingMechanic(launch: MetaplexGenesisLaunchWire): boolean {
  const mechanic = `${launch.mechanic ?? ""} ${launch.type ?? ""}`.toLowerCase();
  return mechanic.includes("bonding") || mechanic.includes("curve");
}
function launchRecencyScore(launch: MetaplexGenesisLaunchWire): number {
  const ts =
    launch.graduatedAt ?? launch.endTime ?? launch.startTime ?? null;
  if (!ts) return 0;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : 0;
}
/** Prefer active bonding-curve launch, else most recent. */
export function pickBestGenesisLaunch(
  launches: readonly MetaplexGenesisLaunchWire[],
): MetaplexGenesisLaunchWire | null {
  if (!launches.length) return null;
  const activeBonding = launches.filter((l) => {
    const status = l.status?.toLowerCase() ?? "";
    return isBondingMechanic(l) && (status === "active" || status === "live" || status === "open");
  });
  const pool = activeBonding.length > 0 ? activeBonding : launches;
  return [...pool].sort((a, b) => launchRecencyScore(b) - launchRecencyScore(a))[0] ?? null;
}
export async function fetchGenesisLaunchesByTokenMint(
  tokenMint: string,
  network: "solana-mainnet" | "solana-devnet" = "solana-mainnet",
): Promise<GenesisTokenLookupResult> {
  const mint = tokenMint.trim();
  if (!mint) {
    return { status: "error", error: "missing_token_mint" };
  }
  const url = new URL(`${GENESIS_API_BASE}/tokens/${encodeURIComponent(mint)}`);
  if (network !== "solana-mainnet") {
    url.searchParams.set("network", network);
  }
  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return {
        status: "error",
        error: `genesis_api_http_${res.status}`,
      };
    }
    const json = await parseBoundedJsonBody(res, GenesisApiResponseSchema, 2 * 1024 * 1024);
    if (!json.data) {
      return { status: "not_found", data: null };
    }
    return { status: "ok", data: json.data };
  } catch (err) {
    const message = Error.isError(err) ? err.message : String(err);
    return { status: "error", error: message };
  }
}
export function genesisLaunchToPartialEnrichment(
  launch: MetaplexGenesisLaunchWire,
): Pick<
  MetaplexGenesisEnrichment,
  "launchAddress" | "launchType" | "launchStatus" | "tradeUrl"
> {
  return {
    launchAddress: launch.genesisAddress?.trim() || null,
    launchType: launch.type?.trim() || launch.mechanic?.trim() || null,
    launchStatus: launch.status?.trim() || null,
    tradeUrl: launch.launchPage?.trim() || null,
  };
}