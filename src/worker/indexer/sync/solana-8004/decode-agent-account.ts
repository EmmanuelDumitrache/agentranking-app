import { PublicKey } from "@solana/web3.js";
import { hasAgentAccountDiscriminator } from "./account-discriminators.js";
import {
  SOLANA_8004_MAX_AGENT_URI_BYTES,
  SOLANA_8004_MAX_COLLECTION_POINTER_BYTES,
  SOLANA_8004_MAX_NFT_NAME_BYTES,
} from "./constants.js";
import { validateBoundedUtf8 } from "./validation.js";

export type DecodedSolana8004AgentAccount = {
  collection: string;
  creator: string;
  cachedOwner: string;
  asset: string;
  bump: number;
  atomEnabled: boolean;
  agentWallet: string | null;
  feedbackDigestHex: string;
  feedbackCount: bigint;
  responseDigestHex: string;
  responseCount: bigint;
  revokeDigestHex: string;
  revokeCount: bigint;
  parentAsset: string | null;
  parentLocked: boolean;
  collectionLocked: boolean;
  agentUri: string;
  nftName: string;
  collectionPointer: string;
};

class Reader {
  #offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  get offset(): number { return this.#offset; }
  take(length: number, label: string): Uint8Array {
    if (!Number.isSafeInteger(length) || length < 0 || this.#offset + length > this.bytes.byteLength) {
      throw new Error(`Solana 8004 AgentAccount is truncated while reading ${label}`);
    }
    const value = this.bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }
  u8(label: string): number { return this.take(1, label)[0]!; }
  bool(label: string): boolean {
    const value = this.u8(label);
    if (value !== 0 && value !== 1) throw new Error(`${label} is not a canonical Borsh boolean`);
    return value === 1;
  }
  u32(label: string): number {
    const bytes = this.take(4, label);
    return new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  }
  u64(label: string): bigint {
    const bytes = this.take(8, label);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
  }
  pubkey(label: string): string { return new PublicKey(this.take(32, label)).toBase58(); }
  optionalPubkey(label: string): string | null {
    const tag = this.u8(`${label} option tag`);
    if (tag === 0) return null;
    if (tag !== 1) throw new Error(`${label} has an invalid Borsh option tag`);
    return this.pubkey(label);
  }
  string(label: string, maxBytes: number): string {
    const length = this.u32(`${label} length`);
    if (length > maxBytes) throw new Error(`${label} declares ${length} bytes, exceeding ${maxBytes}`);
    const bytes = this.take(length, label);
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return validateBoundedUtf8(value, label, maxBytes);
  }
}

function digestHex(reader: Reader, label: string): string {
  return Buffer.from(reader.take(32, label)).toString("hex");
}

export function decodeSolana8004AgentAccount(bytes: Uint8Array): DecodedSolana8004AgentAccount {
  if (!hasAgentAccountDiscriminator(bytes)) throw new Error("Solana 8004 AgentAccount discriminator mismatch");
  const reader = new Reader(bytes);
  reader.take(8, "account discriminator");
  const decoded: DecodedSolana8004AgentAccount = {
    collection: reader.pubkey("collection"),
    creator: reader.pubkey("creator"),
    cachedOwner: reader.pubkey("cached owner"),
    asset: reader.pubkey("asset"),
    bump: reader.u8("bump"),
    atomEnabled: reader.bool("ATOM enabled"),
    agentWallet: reader.optionalPubkey("agent wallet"),
    feedbackDigestHex: digestHex(reader, "feedback digest"),
    feedbackCount: reader.u64("feedback count"),
    responseDigestHex: digestHex(reader, "response digest"),
    responseCount: reader.u64("response count"),
    revokeDigestHex: digestHex(reader, "revoke digest"),
    revokeCount: reader.u64("revoke count"),
    parentAsset: reader.optionalPubkey("parent asset"),
    parentLocked: reader.bool("parent locked"),
    collectionLocked: reader.bool("collection locked"),
    agentUri: reader.string("agent URI", SOLANA_8004_MAX_AGENT_URI_BYTES),
    nftName: reader.string("NFT name", SOLANA_8004_MAX_NFT_NAME_BYTES),
    collectionPointer: reader.string("collection pointer", SOLANA_8004_MAX_COLLECTION_POINTER_BYTES),
  };
  if (reader.offset !== bytes.byteLength) {
    const padding = bytes.slice(reader.offset);
    if (padding.some((value) => value !== 0)) {
      throw new Error(`Solana 8004 AgentAccount has ${padding.byteLength} non-zero trailing bytes outside the pinned layout`);
    }
  }
  return decoded;
}
