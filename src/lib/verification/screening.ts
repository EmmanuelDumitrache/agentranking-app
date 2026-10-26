import denylist from "./data/sanctions-denylist.json";

export interface SanctionsHit {
  address: string;
  reason: string;
}

export interface SanctionsScreenResult {
  clean: boolean;
  hits: SanctionsHit[];
}

export interface SanctionsScreener {
  name: string;
  screenAddresses(addresses: string[]): Promise<SanctionsScreenResult>;
}

type DenylistEntry = {
  address: string;
  chain: string;
  reason: string;
};

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Local denylist screener for Phase 1 demo.
 *
 * TODO(Phase 2): Replace with a real chain-analytics provider adapter
 * (e.g. configure via SANCTIONS_PROVIDER env — Chainalysis / TRM / Elliptic).
 * Keep this interface stable; swap implementation only.
 */
export class MockSanctionsScreener implements SanctionsScreener {
  readonly name = "mock-denylist";

  private readonly blocked = new Map<string, string>(
    (denylist as DenylistEntry[]).map((entry) => [
      normalizeAddress(entry.address),
      entry.reason,
    ]),
  );

  async screenAddresses(addresses: string[]): Promise<SanctionsScreenResult> {
    const hits: SanctionsHit[] = [];
    for (const address of addresses) {
      const key = normalizeAddress(address);
      const reason = this.blocked.get(key);
      if (reason) hits.push({ address, reason });
    }
    return { clean: hits.length === 0, hits };
  }
}

let screenerSingleton: SanctionsScreener | undefined;

export function getSanctionsScreener(): SanctionsScreener {
  if (!screenerSingleton) screenerSingleton = new MockSanctionsScreener();
  return screenerSingleton;
}

/** Test helper — inject a screener without touching production factory callers. */
export function setSanctionsScreenerForTests(screener: SanctionsScreener | undefined): void {
  screenerSingleton = screener;
}
