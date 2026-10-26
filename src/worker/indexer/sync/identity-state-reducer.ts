import { canonicalEvmAddress, canonicalUint256, compareEvmEventPosition, type EvmEventPosition } from "../lib/exact-protocol.js";
export type IdentityState = {
  protocolAgentId: string;
  registeredOwner: string | null;
  currentOwner: string | null;
  currentWallet: string | null | undefined;
  agentUri: string | null | undefined;
  registeredAt: EvmEventPosition | null;
  ownerAt: EvmEventPosition | null;
  walletAt: EvmEventPosition | null;
  hydrationReasons: Set<string>;
  lastLogIndex: number;
};
export type IdentityReducerEvent = {
  eventName: string;
  args: Record<string, unknown>;
  protocolAgentId?: string | null;
  position: EvmEventPosition;
  logIndex: number;
};
function eventAgentId(event: IdentityReducerEvent): string | null {
  if (event.protocolAgentId !== undefined) return event.protocolAgentId;
  const value = event.args.agentId ?? event.args.tokenId;
  return typeof value === "bigint" ? canonicalUint256(value) : null;
}
function cloneState(state: IdentityState): IdentityState {
  return { ...state, hydrationReasons: new Set(state.hydrationReasons) };
}
/**
 * Reduces every identity event in exact canonical log order. Registration provenance and
 * terminal ownership are deliberately independent because a safe-mint receiver can transfer
 * the token before Registered is emitted.
 */
/** Select the implementation post-state for transactions around an upgrade in the same block. */
export function generationStateBlockForTransaction(
  blockNumber: bigint,
  transactionIndex: number,
  earliestUpgradeTransactionIndex: number | null,
): bigint {
  if (earliestUpgradeTransactionIndex == null || transactionIndex >= earliestUpgradeTransactionIndex) return blockNumber;
  return blockNumber > 0n ? blockNumber - 1n : 0n;
}
export function reduceIdentityTransactionStates(
  initial: ReadonlyMap<string, IdentityState>,
  events: readonly IdentityReducerEvent[],
  options?: { alreadySorted?: boolean },
): Map<string, IdentityState> {
  const states = new Map<string, IdentityState>();
  const ordered = options?.alreadySorted
    ? events
    : [...events].sort((a, b) => compareEvmEventPosition(a.position, b.position));
  for (const event of ordered) {
    if (event.eventName === "Upgraded" || event.eventName === "BeaconUpgraded") continue;
    const agentId = eventAgentId(event);
    if (!agentId) continue;
    let state = states.get(agentId);
    if (!state) {
      const prior = initial.get(agentId);
      state = prior ? cloneState(prior) : {
        protocolAgentId: agentId,
        registeredOwner: null,
        currentOwner: null,
        currentWallet: undefined,
        agentUri: undefined,
        registeredAt: null,
        ownerAt: null,
        walletAt: null,
        hydrationReasons: new Set(),
        lastLogIndex: -1,
      };
      states.set(agentId, state);
    }
    state.lastLogIndex = Math.max(state.lastLogIndex, event.logIndex);
    if (event.eventName === "Transfer") {
      const from = canonicalEvmAddress(String(event.args.from));
      const to = canonicalEvmAddress(String(event.args.to));
      state.currentOwner = /^0x0{40}$/i.test(to) ? null : to;
      state.ownerAt = event.position;
      if (!/^0x0{40}$/i.test(from)) state.hydrationReasons.add("ownership-transfer");
      continue;
    }
    if (event.eventName === "Registered") {
      state.registeredOwner = canonicalEvmAddress(String(event.args.owner));
      state.registeredAt = event.position;
      if (typeof event.args.agentURI === "string") state.agentUri = event.args.agentURI;
      state.hydrationReasons.add("registered");
      continue;
    }
    if (event.eventName === "URIUpdated") {
      if (typeof event.args.newURI === "string") state.agentUri = event.args.newURI;
      state.hydrationReasons.add("uri-updated");
      continue;
    }
    if (event.eventName === "MetadataUpdate") {
      state.hydrationReasons.add("erc4906-invalidation");
      continue;
    }
    if (event.eventName === "MetadataSet" && Object.hasOwn(event.args, "decodedAgentWallet")) {
      const wallet = event.args.decodedAgentWallet;
      if (wallet !== undefined && wallet !== null && typeof wallet !== "string") throw new Error("decodedAgentWallet must be a string, null, or undefined");
      state.currentWallet = wallet as string | null | undefined;
      state.walletAt = event.position;
    }
  }
  return states;
}
