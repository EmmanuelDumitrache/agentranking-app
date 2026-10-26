import { Solana8004BorshReader, exactSignedFixedPoint } from "./trust-borsh.js";
import { decodeSolana8004TrustInstructions } from "./trust-instruction-decoder.js";
import type {
  DecodedSolana8004TrustEvent,
  Solana8004InstructionEvidence,
  Solana8004RawTransaction,
  Solana8004TrustKind,
} from "./trust-types.js";

const EVENT_DISCRIMINATORS = new Map<string, Solana8004TrustKind>([
  ["0ea23ac2832a0b95", "FEEDBACK"],
  ["cd101f5e366510c7", "REVOCATION"],
  ["a8a9d6c1ab01e87b", "RESPONSE"],
]);

function* programDataFor(logs: readonly string[], programId: string): Generator<string> {
  const stack: string[] = [];
  for (const line of logs) {
    const invoked = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/.exec(line);
    if (invoked) {
      stack.push(invoked[1]!);
      continue;
    }
    const completed = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/.exec(line);
    if (completed) {
      const index = stack.lastIndexOf(completed[1]!);
      if (index >= 0) stack.splice(index);
      continue;
    }
    if (stack.at(-1) !== programId) continue;
    const data = /^Program data: ([A-Za-z0-9+/]+={0,2})$/.exec(line);
    if (data) yield data[1]!;
  }
}


function canonicalBase64(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.toString("base64") !== value) return null;
  return bytes;
}

function nextInstruction(
  queues: Map<Solana8004TrustKind, { values: Solana8004InstructionEvidence[]; offset: number }>,
  kind: Solana8004TrustKind,
): Solana8004InstructionEvidence | null {
  const queue = queues.get(kind);
  if (!queue) return null;
  const instruction = queue.values[queue.offset];
  if (!instruction) return null;
  queue.offset += 1;
  return instruction;
}

function requireInstruction(
  instruction: Solana8004InstructionEvidence | null,
  kind: Solana8004TrustKind,
): Solana8004InstructionEvidence {
  if (!instruction) throw new Error(`Solana 8004 ${kind.toLowerCase()} event has no matching program instruction`);
  return instruction;
}

function assertEqual<T>(label: string, left: T, right: T): void {
  if (left !== right) throw new Error(`Solana 8004 ${label} does not match its instruction`);
}

export function decodeSolana8004TrustEvents(input: {
  transaction: Solana8004RawTransaction;
  programId: string;
  instructions?: readonly Solana8004InstructionEvidence[];
}): DecodedSolana8004TrustEvent[] {
  if (input.transaction.meta?.err != null) return [];
  const logs = input.transaction.meta?.logMessages ?? [];
  const instructions = input.instructions ?? decodeSolana8004TrustInstructions(input.transaction, input.programId);
  const queues = new Map<Solana8004TrustKind, { values: Solana8004InstructionEvidence[]; offset: number }>([
    ["FEEDBACK", { values: [], offset: 0 }],
    ["RESPONSE", { values: [], offset: 0 }],
    ["REVOCATION", { values: [], offset: 0 }],
  ]);
  for (const instruction of instructions) queues.get(instruction.kind)!.values.push(instruction);
  const out: DecodedSolana8004TrustEvent[] = [];
  let eventOrdinal = 0;
  for (const rawBase64 of programDataFor(logs, input.programId)) {
    const bytes = canonicalBase64(rawBase64);
    if (!bytes || bytes.byteLength < 8) continue;
    const kind = EVENT_DISCRIMINATORS.get(Buffer.from(bytes.subarray(0, 8)).toString("hex"));
    if (!kind) continue;
    const reader = new Solana8004BorshReader(bytes.subarray(8));
    const assetAddress = reader.pubkey("event asset");
    const clientAddress = reader.pubkey("event client");
    const feedbackIndex = reader.u64("event feedback index");
    if (feedbackIndex > 9_223_372_036_854_775_807n) throw new Error("Solana 8004 feedback index exceeds PostgreSQL BIGINT");
    const instruction = requireInstruction(nextInstruction(queues, kind), kind);
    if (kind === "FEEDBACK") {
      const sourceSlot = reader.u64("feedback slot");
      const value = reader.i128("feedback value");
      const valueDecimals = reader.u8("feedback value decimals");
      const score = reader.optionU8("feedback score");
      if (score != null && score > 100) throw new Error("Solana 8004 explicit feedback score exceeds 100");
      const feedbackFileHash = reader.optionBytes32("feedback file hash");
      const sealHash = reader.bytes32("feedback seal hash");
      assertEqual("feedback raw value", value.toString(10), instruction.rawValue ?? null);
      assertEqual("feedback decimals", valueDecimals, instruction.valueDecimals ?? null);
      assertEqual("feedback score", score, instruction.score ?? null);
      assertEqual("feedback file hash", feedbackFileHash, instruction.feedbackFileHash ?? null);
      if (reader.remaining > 0) {
        // Current Solana 8004 emits the full ATOM scoring snapshot and rolling
        // feedback-chain state before the user-authored strings. Parse every
        // field even though the trust projection does not persist the metrics.
        // Historical events predate this extension and end at seal_hash, so
        // zero remaining bytes is the only accepted historical layout.
        reader.bool("feedback ATOM enabled");
        reader.u8("feedback trust tier");
        reader.u16("feedback quality score");
        reader.u16("feedback confidence");
        reader.u8("feedback risk score");
        reader.u8("feedback diversity ratio");
        reader.bool("feedback unique client");
        reader.bytes32("feedback rolling digest");
        reader.u64("feedback rolling count");
        const tag1 = reader.string("feedback tag1", 32);
        const tag2 = reader.string("feedback tag2", 32);
        const endpoint = reader.string("feedback endpoint", 250);
        const feedbackUri = reader.string("feedback URI", 250);
        assertEqual("feedback tag1", tag1, instruction.tag1 ?? null);
        assertEqual("feedback tag2", tag2, instruction.tag2 ?? null);
        assertEqual("feedback endpoint", endpoint, instruction.endpoint ?? null);
        assertEqual("feedback URI", feedbackUri, instruction.feedbackUri ?? null);
      }
      reader.assertExhausted("NewFeedback event");
      out.push({
        kind,
        eventOrdinal: eventOrdinal++,
        assetAddress,
        clientAddress,
        responderAddress: null,
        feedbackIndex,
        rawValue: value.toString(10),
        valueDecimals,
        exactValue: exactSignedFixedPoint(value, valueDecimals),
        score,
        feedbackFileHash: feedbackFileHash ?? instruction?.feedbackFileHash ?? null,
        responseHash: null,
        sealHash,
        sourceSlot,
        instruction,
        rawBase64,
      });
      continue;
    }
    if (kind === "REVOCATION") {
      const sealHash = reader.bytes32("revocation seal hash");
      const sourceSlot = reader.u64("revocation slot");
      if (reader.remaining > 0) {
        reader.u8("revocation original score");
        reader.bool("revocation ATOM enabled");
        reader.bool("revocation had impact");
        reader.u8("revocation trust tier");
        reader.u16("revocation quality score");
        reader.u16("revocation confidence");
        reader.bytes32("revocation rolling digest");
        reader.u64("revocation rolling count");
      }
      assertEqual("revocation feedback index", feedbackIndex, instruction.feedbackIndex ?? null);
      assertEqual("revocation seal hash", sealHash, instruction.sealHash ?? null);
      reader.assertExhausted("FeedbackRevoked event");
      out.push({
        kind,
        eventOrdinal: eventOrdinal++,
        assetAddress,
        clientAddress,
        responderAddress: null,
        feedbackIndex,
        rawValue: null,
        valueDecimals: null,
        exactValue: null,
        score: null,
        feedbackFileHash: null,
        responseHash: null,
        sealHash,
        sourceSlot,
        instruction,
        rawBase64,
      });
      continue;
    }
    const sourceSlot = reader.u64("response slot");
    const responderAddress = reader.pubkey("response author");
    const responseHash = reader.bytes32("response hash");
    const sealHash = reader.bytes32("response seal hash");
    let responseUri: string | null = null;
    if (reader.remaining > 0) {
      reader.bytes32("response rolling digest");
      reader.u64("response rolling count");
      responseUri = reader.string("response URI", 250);
    }
    assertEqual("response client", clientAddress, instruction.clientAddress ?? null);
    assertEqual("response feedback index", feedbackIndex, instruction.feedbackIndex ?? null);
    assertEqual("response hash", responseHash, instruction.responseHash ?? null);
    assertEqual("response seal hash", sealHash, instruction.sealHash ?? null);
    if (responseUri !== null) {
      assertEqual("response URI", responseUri, instruction.responseUri ?? null);
    }
    reader.assertExhausted("ResponseAppended event");
    out.push({
      kind,
      eventOrdinal: eventOrdinal++,
      assetAddress,
      clientAddress,
      responderAddress,
      feedbackIndex,
      rawValue: null,
      valueDecimals: null,
      exactValue: null,
      score: null,
      feedbackFileHash: null,
      responseHash,
      sealHash,
      sourceSlot,
      instruction,
      rawBase64,
    });
  }
  return out;
}
