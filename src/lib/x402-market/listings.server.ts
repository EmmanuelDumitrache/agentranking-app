import { isAddress } from "viem";
import { prisma } from "@/lib/db";
import { agentPublicPath } from "@/lib/agent-public-url";
import { extendAgentWhereIndexable } from "@/lib/agent-indexing";
import { isValidSolanaPublicKey } from "@/lib/custodial-wallet/validate";
import { loadX402DirectorySnapshot, type X402DirectoryRow } from "@/lib/x402-market/external-directory";
import { enqueueX402DirectoryRefresh } from "@/lib/x402-market/jobs";
import { STATIC_X402_MARKET_LISTINGS } from "@/lib/x402-market/static-listings";
import { loadAllIndexedX402Descriptors } from "@/lib/inference-providers/descriptor-store";
import {
  clampReputationScore,
  inferCategory,
  inferListingType,
  inferPaymentTokens,
  type X402MarketListing,
  type X402MarketListingSource,
} from "@/lib/x402-market/types";
const PER_PAGE = 25;
export type X402MarketSearchMeta = {
  total: number;
  page: number;
  perPage: number;
  sources: Record<X402MarketListingSource, number>;
};
function formatUsdPrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Pay per call";
  if (value < 0.01) return `$${value.toFixed(4)} / call`;
  return `$${value.toFixed(2)} / call`;
}
function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
function networkLabelFromCodes(networks: string[]): string {
  if (networks.length === 0) return "Multi-chain";
  const labels = networks.map((n) => {
    const code = n.toUpperCase();
    if (code === "SOL" || code.includes("SOLANA")) return "Solana";
    if (code === "BSE" || code.includes("8453") || code.includes("BASE")) return "Base";
    if (code.includes("ETH")) return "Ethereum";
    return n;
  });
  return [...new Set(labels)].join(" · ");
}
function descriptorUrl(baseUrl: string): string {
  try {
    const url = new URL(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`);
    return `${url.origin}/.well-known/x402`;
  } catch {
    const trimmed = baseUrl.replace(/\/+$/, "");
    return `${trimmed}/.well-known/x402`;
  }
}
function networkFromPaymentWallet(paymentWallet: string): string {
  const wallet = paymentWallet.trim();
  if (isValidSolanaPublicKey(wallet)) return "Solana";
  if (isAddress(wallet)) return "EVM";
  return "Multi-chain";
}
export function buildX402PayPrompt(input: {
  title: string;
  method: string;
  callSnippet: string;
  openHref: string;
  descriptorHref?: string;
  network: string;
  price: string;
  paymentTokens?: string[];
}): string {
  const tokens = input.paymentTokens?.length ? input.paymentTokens.join(" · ") : "USDC";
  const descriptorSource = input.descriptorHref ?? input.openHref;
  const host = hostnameFromUrl(descriptorSource);
  const descriptor = host ? descriptorUrl(descriptorSource.startsWith("http") ? descriptorSource : `https://${host}`) : "";
  return [
    "Call this x402 service from your agent wallet:",
    "",
    input.callSnippet,
    `Network: ${input.network} · ${tokens}`,
    `Price: ${input.price}`,
    descriptor ? `Descriptor: ${descriptor}` : null,
    "",
    `# ${input.title}`,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}
function finalizeListing(
  partial: {
    id: string;
    title: string;
    owner: string;
    ownerHref?: string;
    summary: string;
    type: X402MarketListing["type"];
    category: string;
    price: string;
    network: string;
    paymentTokens: string[];
    reputation: number;
    endpointCount: number;
    status: "Verified" | "Unverified";
    docsHref: string;
    callSnippet: string;
    requestHref: string;
    source: X402MarketListingSource;
    openHref: string;
    method?: string;
    sourceLabel: string;
    statusOnline?: boolean;
    extraTags?: string[];
  },
): X402MarketListing {
  const method =
    partial.method ??
    (partial.callSnippet.trim().split(/\s+/)[0]?.toUpperCase() || "GET");
  const tags = [method, partial.network.split("·")[0]?.trim() || partial.network, "x402"];
  if (partial.status === "Verified") tags.push("Verified");
  if (partial.extraTags) tags.push(...partial.extraTags);
  const payPrompt = buildX402PayPrompt({
    title: partial.title,
    method,
    callSnippet: partial.callSnippet,
    openHref: partial.openHref,
    network: partial.network,
    price: partial.price,
    paymentTokens: partial.paymentTokens,
  });
  return {
    ...partial,
    isX402MarketEligible: true,
    method,
    tags,
    payPrompt,
    statusOnline: partial.statusOnline ?? true,
  };
}
function loadStaticListings(): X402MarketListing[] {
  return [...STATIC_X402_MARKET_LISTINGS];
}
function listingDedupeKey(listing: Pick<X402MarketListing, "title" | "openHref">): string {
  const host = hostnameFromUrl(listing.openHref).toLowerCase();
  const title = listing.title.trim().toLowerCase();
  return `${host}::${title}`;
}
function scoreListing(listing: X402MarketListing, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) {
    const sourceBoost =
      listing.source === "external"
        ? 60
        : listing.source === "published"
          ? 50
          : listing.source === "inference"
            ? 45
            : 0;
    return (
      sourceBoost +
      listing.reputation +
      (listing.statusOnline ? 10 : 0) +
      (listing.status === "Verified" ? 5 : 0)
    );
  }
  const hay = [
    listing.title,
    listing.summary,
    listing.owner,
    listing.category,
    listing.type,
    listing.network,
    listing.tags.join(" "),
    hostnameFromUrl(listing.openHref),
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;
  const terms = q.split(/\s+/).filter(Boolean);
  for (const term of terms) {
    if (hay.includes(term)) score += 12;
    if (listing.title.toLowerCase().includes(term)) score += 18;
    if (hostnameFromUrl(listing.openHref).includes(term)) score += 8;
  }
  if (hay.includes(q)) score += 25;
  score += listing.reputation * 0.15;
  if (listing.statusOnline) score += 8;
  if (listing.status === "Verified") score += 5;
  return score;
}
function matchesQuery(listing: X402MarketListing, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = [
    listing.title,
    listing.summary,
    listing.owner,
    listing.category,
    listing.type,
    listing.network,
    listing.tags.join(" "),
    hostnameFromUrl(listing.openHref),
  ].join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}
function dedupeAndRank(listings: X402MarketListing[], query: string): X402MarketListing[] {
  const byKey = new Map<string, X402MarketListing>();
  for (const listing of listings) {
    if (!matchesQuery(listing, query)) continue;
    const key = listingDedupeKey(listing);
    const existing = byKey.get(key);
    if (!existing || listing.reputation > existing.reputation) {
      byKey.set(key, listing);
    }
  }
  return [...byKey.values()].sort((a, b) => scoreListing(b, query) - scoreListing(a, query));
}
async function loadExternalRows(): Promise<{ rows: X402DirectoryRow[]; total: number }> {
  const cached = await loadX402DirectorySnapshot();
  if (!cached || cached.status === "stale") {
    void enqueueX402DirectoryRefresh().catch((error) => {
      console.warn("[x402-market] could not enqueue directory refresh", error);
    });
  }
  return cached ? { rows: cached.value.rows, total: cached.value.providerTotal } : { rows: [], total: 0 };
}
function mapExternalRow(row: X402DirectoryRow): X402MarketListing {
  const baseUrl = row.base_url?.trim() || row.website_url?.trim() || "";
  const host = hostnameFromUrl(baseUrl);
  const summary =
    row.assessment?.summary?.value?.trim() || row.description?.trim() || "x402 pay-per-call API.";
  const network = networkLabelFromCodes(row.networks ?? []);
  const price = formatUsdPrice(row.min_price_usd);
  const method = "GET";
  const callSnippet = `GET ${baseUrl.replace(/\/+$/, "")}/`;
  const openHref = row.website_url?.trim() || baseUrl;
  const paymentTokens = inferPaymentTokens(`${network} USDC`);
  const reputation = clampReputationScore(
    row.verified ? 88 : row.status === "online" ? 72 : 55,
  );
  const partial = {
    id: `external-${row.slug}`,
    title: row.name,
    owner: host || row.name,
    summary,
    type: inferListingType(row.name, summary),
    category: row.category || inferCategory(row.name, summary),
    price,
    network,
    paymentTokens,
    reputation,
    endpointCount: row.endpoint_count ?? 1,
    // A third-party directory flag is useful provenance, but it is not an
    // AgentRanking verification. Only first-party verification may set this
    // field to "Verified".
    status: "Unverified" as const,
    docsHref: openHref,
    callSnippet,
    requestHref: baseUrl,
    isX402MarketEligible: true as const,
    source: "external" as const,
  };
  const payPrompt = buildX402PayPrompt({
    title: partial.title,
    method,
    callSnippet,
    openHref,
    descriptorHref: baseUrl,
    network,
    price,
    paymentTokens,
  });
  const tags = [method, network.split("·")[0]?.trim() || "Multi-chain", "x402"];
  if (row.verified) tags.push("Directory verified");
  if (row.status === "online") tags.push("Online");
  return {
    ...partial,
    openHref,
    payPrompt,
    method,
    tags,
    sourceLabel: "x402 List",
    statusOnline: row.status === "online",
  };
}
async function loadPublishedAgentListings(): Promise<X402MarketListing[]> {
  const publicAgentWhere = await extendAgentWhereIndexable();
  const [paidServices, mcpOffers] = await Promise.all([
    prisma.agentPaidService.findMany({
      where: { isPublished: true, endpointUrl: { not: "" }, agent: publicAgentWhere },
      include: {
        agent: { select: { id: true, name: true, chainId: true, agentId: true, score: true, isVerified: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
    prisma.agentMcpOffer.findMany({
      where: { isPublished: true, agent: publicAgentWhere },
      include: {
        agent: { select: { id: true, name: true, chainId: true, agentId: true, score: true, isVerified: true } },
        linkedService: { select: { endpoint: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    }),
  ]);
  const listings: X402MarketListing[] = [];
  for (const service of paidServices) {
    const endpoint = service.endpointUrl.trim();
    if (!endpoint) continue;
    const agent = service.agent;
    const ownerHref = agentPublicPath({ chainId: agent.chainId, agentId: Number(agent.agentId), name: agent.name });
    const price =
      service.priceLabel.trim() ||
      (service.priceUsd != null ? formatUsdPrice(service.priceUsd) : "Pay per call");
    const method = "GET";
    const callSnippet = `${method} ${endpoint}`;
    const network = networkFromPaymentWallet(service.paymentWallet);
    const partial = {
      id: `published-service-${service.id}`,
      title: service.title,
      owner: agent.name,
      ownerHref,
      summary: service.description.trim() || "Published x402-ready agent service.",
      type: inferListingType(service.title, service.description),
      category: inferCategory(service.title, service.description),
      price,
      network,
      paymentTokens: inferPaymentTokens(`${network} ${price}`),
      reputation: clampReputationScore(agent.score),
      endpointCount: 1,
      status: agent.isVerified ? ("Verified" as const) : ("Unverified" as const),
      docsHref: ownerHref,
      callSnippet,
      requestHref: endpoint,
      isX402MarketEligible: true as const,
      source: "published" as const,
    };
    listings.push(
      finalizeListing({
        ...partial,
        openHref: endpoint,
        sourceLabel: "AgentRanking Agent",
        extraTags: [agent.isVerified ? "Verified" : "Agent"],
      }),
    );
  }
  for (const offer of mcpOffers) {
    const agent = offer.agent;
    const ownerHref = agentPublicPath({ chainId: agent.chainId, agentId: Number(agent.agentId), name: agent.name });
    const requestHref = offer.ctaUrl.trim() || offer.linkedService?.endpoint.trim() || "";
    if (!requestHref) continue;
    const openHref = requestHref;
    const price = offer.priceLabel.trim() || "Pay per call";
    const method = "GET";
    const callSnippet = `${method} ${requestHref}`;
    const partial = {
      id: `published-mcp-${offer.id}`,
      title: offer.title,
      owner: agent.name,
      ownerHref,
      summary: offer.summary.trim() || "Published MCP offer from a verified agent profile.",
      type: "MCP Server" as const,
      category: inferCategory(offer.title, offer.summary),
      price,
      network: "Multi-chain",
      paymentTokens: inferPaymentTokens(price),
      reputation: clampReputationScore(agent.score),
      endpointCount: 1,
      status: agent.isVerified ? ("Verified" as const) : ("Unverified" as const),
      docsHref: ownerHref,
      callSnippet,
      requestHref,
      isX402MarketEligible: true as const,
      source: "published" as const,
    };
    listings.push(
      finalizeListing({
        ...partial,
        openHref,
        sourceLabel: "AgentRanking Agent",
        extraTags: ["MCP"],
      }),
    );
  }
  return listings;
}
async function loadInferenceListings(): Promise<X402MarketListing[]> {
  const descriptors = await loadAllIndexedX402Descriptors();
  const listings: X402MarketListing[] = [];
  for (const descriptor of descriptors) {
    const baseUrl = descriptor.sourceUrl.replace(/\/\.well-known\/x402\/?$/, "");
    for (const [index, endpoint] of descriptor.endpoints.entries()) {
      const path = endpoint.path.startsWith("/") ? endpoint.path : `/${endpoint.path}`;
      const fullUrl = `${baseUrl}${path}`;
      const method = endpoint.method.toUpperCase();
      const price = formatUsdPrice(endpoint.flatFeeUsd);
      const summary = `${descriptor.description} — ${endpoint.type} endpoint.`;
      const partial = {
        id: `inference-${descriptor.providerId}-${index}`,
        title: `${descriptor.name} · ${path}`,
        owner: descriptor.name,
        ownerHref: descriptor.homepage ?? descriptor.docs ?? undefined,
        summary,
        type: inferListingType(descriptor.name, summary),
        category: inferCategory(descriptor.name, summary),
        price,
        network: networkLabelFromCodes(descriptor.paymentChains),
        paymentTokens: inferPaymentTokens(descriptor.paymentChains.join(" ")),
        reputation: 90,
        endpointCount: descriptor.endpoints.length,
        status: "Verified" as const,
        docsHref: descriptor.docs ?? descriptor.sourceUrl,
        callSnippet: `${method} ${fullUrl}`,
        requestHref: fullUrl,
        isX402MarketEligible: true as const,
        source: "inference" as const,
      };
      listings.push(
        finalizeListing({
          ...partial,
          openHref: fullUrl,
          method,
          sourceLabel: "Inference Partner",
          extraTags: ["Inference"],
        }),
      );
    }
  }
  return listings;
}
function countBySource(listings: X402MarketListing[]): Record<X402MarketListingSource, number> {
  const counts: Record<X402MarketListingSource, number> = {
    curated: 0,
    native: 0,
    published: 0,
    inference: 0,
    external: 0,
  };
  for (const listing of listings) {
    counts[listing.source] += 1;
  }
  return counts;
}
export async function searchX402MarketListings({
  q = "",
  page = 1,
}: {
  readonly q?: string;
  readonly page?: number;
}): Promise<{ data: X402MarketListing[]; meta: X402MarketSearchMeta }> {
  const query = q.trim();
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const [staticListings, published, inference, externalPayload] = await Promise.all([
    Promise.resolve(loadStaticListings()),
    loadPublishedAgentListings(),
    loadInferenceListings(),
    loadExternalRows(),
  ]);
  const external = externalPayload.rows.map(mapExternalRow);
  const merged = dedupeAndRank(
    [...staticListings, ...published, ...inference, ...external],
    query,
  );
  const start = (safePage - 1) * PER_PAGE;
  const pageRows = merged.slice(start, start + PER_PAGE);
  const total = merged.length;
  return {
    data: pageRows,
    meta: {
      total,
      page: safePage,
      perPage: PER_PAGE,
      sources: countBySource(merged),
    },
  };
}
export function mergeListingsForSearch(
  listings: X402MarketListing[],
  query: string,
): X402MarketListing[] {
  return dedupeAndRank(listings, query);
}
