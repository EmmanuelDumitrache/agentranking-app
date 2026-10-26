import bs58 from "bs58";
import { Solana8004BorshReader } from "./trust-borsh.js";
import type { Solana8004InstructionEvidence, Solana8004RawTransaction, Solana8004TrustKind } from "./trust-types.js";

const INSTRUCTION_DISCRIMINATORS = new Map<string, Solana8004TrustKind>([
  [Buffer.from([145, 136, 123, 3, 215, 165, 98, 41]).toString("hex"), "FEEDBACK"],
  [Buffer.from([162, 210, 186, 50, 180, 4, 47, 104]).toString("hex"), "RESPONSE"],
  [Buffer.from([211, 37, 230, 82, 118, 216, 137, 206]).toString("hex"), "REVOCATION"],
]);

type RawInstruction = {
  programIdIndex: number;
  accounts?: number[];
  accountKeyIndexes?: number[];
  data?: string;
};

function keyText(value: string | { pubkey?: string }): string {
  return typeof value === "string" ? value : value.pubkey ?? "";
}

export function resolvedTransactionKeys(transaction: Solana8004RawTransaction): string[] {
  const message = transaction.transaction?.message;
  const staticKeys = (message?.staticAccountKeys ?? message?.accountKeys ?? []).map(keyText);
  const writable = transaction.meta?.loadedAddresses?.writable ?? [];
  const readonly = transaction.meta?.loadedAddresses?.readonly ?? [];
  return [...staticKeys, ...writable, ...readonly];
}

function decodeInstruction(
  instruction: RawInstruction,
  programId: string,
  keys: readonly string[],
  identity: { outerInstructionIndex: number; innerInstructionOrdinal: number | null },
): Solana8004InstructionEvidence | null {
  if (keys[instruction.programIdIndex] !== programId || typeof instruction.data !== "string") return null;
  let bytes: Uint8Array;
  try { bytes = bs58.decode(instruction.data); } catch { return null; }
  if (bytes.byteLength < 8) return null;
  const kind = INSTRUCTION_DISCRIMINATORS.get(Buffer.from(bytes.subarray(0, 8)).toString("hex"));
  if (!kind) return null;
  const reader = new Solana8004BorshReader(bytes.subarray(8));
  if (kind === "FEEDBACK") {
    const rawValue = reader.i128("feedback value").toString(10);
    const valueDecimals = reader.u8("feedback value decimals");
    const score = reader.optionU8("feedback score");
    const feedbackFileHash = reader.optionBytes32("feedback file hash");
    const tag1 = reader.string("feedback tag1", 32);
    const tag2 = reader.string("feedback tag2", 32);
    const endpoint = reader.string("feedback endpoint", 250);
    const feedbackUri = reader.string("feedback URI", 250);
    reader.assertExhausted("give_feedback instruction");
    return { kind, ...identity, rawValue, valueDecimals, score, tag1, tag2, endpoint, feedbackUri, feedbackFileHash };
  }
  if (kind === "RESPONSE") {
    const clientAddress = reader.pubkey("feedback client");
    const feedbackIndex = reader.u64("feedback index");
    const responseUri = reader.string("response URI", 250);
    const responseHash = reader.bytes32("response hash");
    const sealHash = reader.bytes32("seal hash");
    reader.assertExhausted("append_response instruction");
    return { kind, ...identity, clientAddress, feedbackIndex, responseUri, responseHash, sealHash };
  }
  const feedbackIndex = reader.u64("feedback index");
  const sealHash = reader.bytes32("seal hash");
  reader.assertExhausted("revoke_feedback instruction");
  return { kind, ...identity, feedbackIndex, sealHash };
}

export function decodeSolana8004TrustInstructions(
  transaction: Solana8004RawTransaction,
  programId: string,
  resolvedKeys?: readonly string[],
): Solana8004InstructionEvidence[] {
  const keys = resolvedKeys ?? resolvedTransactionKeys(transaction);
  const message = transaction.transaction?.message;
  const outer = (message?.compiledInstructions ?? message?.instructions ?? []) as RawInstruction[];
  const innerByOuterIndex = new Map<number, readonly RawInstruction[]>();
  for (const group of transaction.meta?.innerInstructions ?? []) {
    if (!innerByOuterIndex.has(group.index)) {
      innerByOuterIndex.set(group.index, group.instructions as RawInstruction[]);
    }
  }
  const result: Solana8004InstructionEvidence[] = [];
  for (let outerInstructionIndex = 0; outerInstructionIndex < outer.length; outerInstructionIndex += 1) {
    const instruction = outer[outerInstructionIndex]!;
    const decoded = decodeInstruction(instruction, programId, keys, { outerInstructionIndex, innerInstructionOrdinal: null });
    if (decoded) result.push(decoded);
    const inner = innerByOuterIndex.get(outerInstructionIndex) ?? [];
    for (let innerInstructionOrdinal = 0; innerInstructionOrdinal < inner.length; innerInstructionOrdinal += 1) {
      const nestedInstruction = inner[innerInstructionOrdinal]!;
      const nested = decodeInstruction(nestedInstruction, programId, keys, { outerInstructionIndex, innerInstructionOrdinal });
      if (nested) result.push(nested);
    }
  }
  return result;
}
