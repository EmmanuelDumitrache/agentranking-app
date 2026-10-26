import { createHash } from "node:crypto";
import bs58 from "bs58";

export const METAPLEX_AGENT_IDENTITY_PROGRAM_ID = "1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p";
export const METAPLEX_AGENT_TOOLS_PROGRAM_ID = "TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S";
export const METAPLEX_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d";
export const SOLANA_AGENT_INSTRUCTION_DECODER_VERSION = "metaplex-agent-instruction/1";

type KnownInstruction = {
  programId: string;
  programName: string;
  name: string;
  snakeName: string;
  accountRoles: readonly string[];
  securityEffect: string;
  decodeArguments?: (bytes: Uint8Array) => Record<string, unknown>;
};

function anchorDiscriminator(name: string): string {
  return createHash("sha256").update(`global:${name}`).digest("hex").slice(0, 16);
}

function decodeBorshString(bytes: Uint8Array, offset: number, label: string): Record<string, unknown> {
  if (bytes.byteLength < offset + 4) return { [`${label}DecodeError`]: "missing u32 string length" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(offset, true);
  if (length > 16_384 || bytes.byteLength < offset + 4 + length) {
    return { [`${label}DecodeError`]: "invalid or truncated Borsh string", declaredLength: length };
  }
  const raw = bytes.subarray(offset + 4, offset + 4 + length);
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { [label]: value, trailingByteLength: bytes.byteLength - (offset + 4 + length) };
  } catch {
    return {
      [`${label}DecodeError`]: "string is not valid UTF-8",
      rawBase64: Buffer.from(raw).toString("base64"),
    };
  }
}

const KNOWN_INSTRUCTIONS: readonly KnownInstruction[] = [
  {
    programId: METAPLEX_AGENT_IDENTITY_PROGRAM_ID,
    programName: "MPL Agent Identity",
    name: "RegisterIdentityV1",
    snakeName: "register_identity_v1",
    accountRoles: ["agentIdentity", "asset", "collection", "payer", "authority", "mplCoreProgram", "systemProgram"],
    securityEffect: "Creates the agent identity PDA and attaches AgentIdentity lifecycle hooks to the MPL Core asset.",
    decodeArguments: (bytes) => decodeBorshString(bytes, 8, "agentRegistrationUri"),
  },
  {
    programId: METAPLEX_AGENT_TOOLS_PROGRAM_ID,
    programName: "MPL Agent Tools",
    name: "RegisterExecutiveV1",
    snakeName: "register_executive_v1",
    accountRoles: ["executiveProfile", "payer", "authority", "systemProgram"],
    securityEffect: "Creates an executive profile that may later receive per-agent execution delegation.",
  },
  {
    programId: METAPLEX_AGENT_TOOLS_PROGRAM_ID,
    programName: "MPL Agent Tools",
    name: "DelegateExecutionV1",
    snakeName: "delegate_execution_v1",
    accountRoles: ["executiveProfile", "agentAsset", "agentIdentity", "executionDelegateRecord", "payer", "authority", "systemProgram"],
    securityEffect: "Grants broad execution authority over the agent Asset Signer path to the executive profile.",
  },
  {
    programId: METAPLEX_AGENT_TOOLS_PROGRAM_ID,
    programName: "MPL Agent Tools",
    name: "RevokeExecutionV1",
    snakeName: "revoke_execution_v1",
    accountRoles: ["executionDelegateRecord", "agentAsset", "destination", "payer", "authority", "systemProgram"],
    securityEffect: "Closes the execution delegation record; prior downstream approvals or state are not reverted.",
  },
] as const;

const KNOWN_BY_KEY = new Map(
  KNOWN_INSTRUCTIONS.map((definition) => [
    `${definition.programId}:${anchorDiscriminator(definition.snakeName)}`,
    definition,
  ]),
);

const PROGRAM_NAMES = new Map<string, string>([
  [METAPLEX_AGENT_IDENTITY_PROGRAM_ID, "MPL Agent Identity"],
  [METAPLEX_AGENT_TOOLS_PROGRAM_ID, "MPL Agent Tools"],
  [METAPLEX_CORE_PROGRAM_ID, "MPL Core"],
  ["11111111111111111111111111111111", "System Program"],
  ["ComputeBudget111111111111111111111111111111", "Compute Budget"],
  ["ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", "Associated Token Account"],
  ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "SPL Token"],
  ["TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", "SPL Token 2022"],
]);

export type DecodedSolanaInstruction = {
  decoderVersion: string;
  programId: string | null;
  programName: string | null;
  dataEncoding: "base58" | "none" | "parsed";
  dataByteLength: number | null;
  discriminatorHex: string | null;
  instructionName: string | null;
  accountRoles: Array<{ role: string; address: string | null; index: number }>;
  arguments: Record<string, unknown> | null;
  securityEffect: string | null;
  decodeError: string | null;
};

export function decodeSolanaAgentInstruction(input: {
  programId: string | null;
  accounts: readonly (string | null)[];
  data: unknown;
  parsed?: unknown;
}): DecodedSolanaInstruction {
  const programId = input.programId;
  const programName = programId ? PROGRAM_NAMES.get(programId) ?? null : null;
  if (input.parsed != null) {
    return {
      decoderVersion: SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
      programId,
      programName,
      dataEncoding: "parsed",
      dataByteLength: null,
      discriminatorHex: null,
      instructionName: null,
      accountRoles: [],
      arguments: { parsed: input.parsed },
      securityEffect: null,
      decodeError: null,
    };
  }
  if (typeof input.data !== "string" || input.data.length === 0) {
    return {
      decoderVersion: SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
      programId,
      programName,
      dataEncoding: "none",
      dataByteLength: 0,
      discriminatorHex: null,
      instructionName: null,
      accountRoles: [],
      arguments: null,
      securityEffect: null,
      decodeError: null,
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(input.data);
  } catch (error) {
    return {
      decoderVersion: SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
      programId,
      programName,
      dataEncoding: "base58",
      dataByteLength: null,
      discriminatorHex: null,
      instructionName: null,
      accountRoles: [],
      arguments: null,
      securityEffect: null,
      decodeError: error instanceof Error ? error.message : String(error),
    };
  }
  const discriminatorHex = bytes.byteLength >= 8 ? Buffer.from(bytes.subarray(0, 8)).toString("hex") : null;
  const definition = programId && discriminatorHex
    ? KNOWN_BY_KEY.get(`${programId}:${discriminatorHex}`) ?? null
    : null;
  return {
    decoderVersion: SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
    programId,
    programName,
    dataEncoding: "base58",
    dataByteLength: bytes.byteLength,
    discriminatorHex,
    instructionName: definition?.name ?? null,
    accountRoles: definition
      ? definition.accountRoles.map((role, index) => ({ role, address: input.accounts[index] ?? null, index }))
      : [],
    arguments: definition?.decodeArguments ? definition.decodeArguments(bytes) : null,
    securityEffect: definition?.securityEffect ?? null,
    decodeError: null,
  };
}

export function summarizeDecodedSolanaInstructions(
  outer: readonly Record<string, unknown>[],
  inner: readonly Record<string, unknown>[],
): Record<string, unknown> {
  const all = [...outer, ...inner];
  const decoded = all.map((instruction) => instruction.decoded).filter((value) => value && typeof value === "object") as DecodedSolanaInstruction[];
  const programIds = [...new Set(decoded.map((item) => item.programId).filter((value): value is string => Boolean(value)))];
  const agentInstructions = decoded.filter((item) => item.programId === METAPLEX_AGENT_IDENTITY_PROGRAM_ID || item.programId === METAPLEX_AGENT_TOOLS_PROGRAM_ID);
  return {
    decoderVersion: SOLANA_AGENT_INSTRUCTION_DECODER_VERSION,
    instructionCount: all.length,
    outerInstructionCount: outer.length,
    innerInstructionCount: inner.length,
    programIds,
    knownAgentInstructionCount: agentInstructions.filter((item) => item.instructionName != null).length,
    agentInstructions,
  };
}
