export const SOLANA_8004_TRUST_DECODER_VERSION = "solana-8004-trust/2";

export type Solana8004TrustKind = "FEEDBACK" | "RESPONSE" | "REVOCATION";
export type Solana8004TrustIntegrity = "MATCH" | "MISMATCH" | "PARENT_MISSING" | "SELF";
export type Solana8004TrustStatus = "FINALIZED" | "ORPHANED" | "INVALID";

export type Solana8004InstructionEvidence = {
  kind: Solana8004TrustKind;
  outerInstructionIndex: number;
  innerInstructionOrdinal: number | null;
  tag1?: string | null;
  tag2?: string | null;
  endpoint?: string | null;
  feedbackUri?: string | null;
  rawValue?: string | null;
  valueDecimals?: number | null;
  score?: number | null;
  clientAddress?: string | null;
  feedbackIndex?: bigint | null;
  feedbackFileHash?: string | null;
  responseUri?: string | null;
  responseHash?: string | null;
  sealHash?: string | null;
};

export type DecodedSolana8004TrustEvent = {
  kind: Solana8004TrustKind;
  eventOrdinal: number;
  assetAddress: string;
  clientAddress: string;
  responderAddress: string | null;
  feedbackIndex: bigint;
  rawValue: string | null;
  valueDecimals: number | null;
  exactValue: string | null;
  score: number | null;
  feedbackFileHash: string | null;
  responseHash: string | null;
  sealHash: string;
  sourceSlot: bigint;
  instruction: Solana8004InstructionEvidence | null;
  rawBase64: string;
};

export type Solana8004TrustCursor = {
  version: 1;
  mode: "backfill" | "tail";
  before: string | null;
  headSignature: string | null;
  passHeadSignature: string | null;
  targetSlot: string | null;
};

export type Solana8004RawTransaction = {
  slot: number;
  blockTime?: number | null;
  meta?: {
    err?: unknown;
    logMessages?: string[] | null;
    loadedAddresses?: { writable?: string[]; readonly?: string[] } | null;
    innerInstructions?: Array<{
      index: number;
      instructions: Array<{
        programIdIndex: number;
        accounts?: number[];
        accountKeyIndexes?: number[];
        data?: string;
        stackHeight?: number | null;
      }>;
    }> | null;
  } | null;
  transaction?: {
    message?: {
      accountKeys?: Array<string | { pubkey?: string }>;
      staticAccountKeys?: Array<string | { pubkey?: string }>;
      instructions?: Array<{
        programIdIndex: number;
        accounts?: number[];
        accountKeyIndexes?: number[];
        data?: string;
      }>;
      compiledInstructions?: Array<{
        programIdIndex: number;
        accounts?: number[];
        accountKeyIndexes?: number[];
        data?: string;
      }>;
    };
  };
  version?: "legacy" | number;
};
