import { createHash } from "node:crypto";
import { config } from "../../config.js";
import pinnedIdl from "./idl/agent-registry-8004.mainnet.json" with { type: "json" };
import {
  SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR,
  SOLANA_8004_MAINNET_PROGRAM_ID,
  SOLANA_8004_PINNED_IDL_SHA256,
  SOLANA_8004_REGISTRY_CONFIG_DISCRIMINATOR,
  SOLANA_8004_ROOT_CONFIG_DISCRIMINATOR,
  SOLANA_MAINNET_GENESIS_HASH,
} from "./constants.js";

function canonicalIdlBytes(): Buffer {
  return Buffer.from(JSON.stringify(pinnedIdl), "utf8");
}

export type Solana8004ProgramDefinition = {
  programId: string;
  genesisHash: string;
  idlHash: string;
  agentAccountDiscriminator: Uint8Array;
};

let programDefinitionCache: Solana8004ProgramDefinition | null = null;

export function loadSolana8004ProgramDefinition(): Solana8004ProgramDefinition {
  if (programDefinitionCache) return programDefinitionCache;
  const actualHash = createHash("sha256").update(canonicalIdlBytes()).digest("hex");
  if (actualHash !== SOLANA_8004_PINNED_IDL_SHA256) {
    throw new Error(`Pinned Solana 8004 IDL hash mismatch: expected ${SOLANA_8004_PINNED_IDL_SHA256}, observed ${actualHash}`);
  }
  const configuredHash = config.solana8004IdlSha256;
  if (configuredHash !== actualHash) {
    throw new Error(`SOLANA_8004_IDL_SHA256 does not match the committed IDL (${actualHash})`);
  }
  const programId = config.solana8004ProgramId || SOLANA_8004_MAINNET_PROGRAM_ID;
  if (programId !== pinnedIdl.address) {
    throw new Error(`Configured Solana 8004 program ${programId} does not match pinned IDL address ${pinnedIdl.address}`);
  }
  const expectedDiscriminators = new Map<string, Uint8Array>([
    ["agentAccount", SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR],
    ["rootConfig", SOLANA_8004_ROOT_CONFIG_DISCRIMINATOR],
    ["registryConfig", SOLANA_8004_REGISTRY_CONFIG_DISCRIMINATOR],
  ]);
  for (const [name, discriminator] of expectedDiscriminators) {
    const account = pinnedIdl.accounts.find((value) => value.name === name);
    if (!account || JSON.stringify(account.discriminator) !== JSON.stringify([...discriminator])) {
      throw new Error(`Pinned Solana 8004 IDL ${name} discriminator is inconsistent with the decoder`);
    }
  }
  const typeNames = new Set(pinnedIdl.types.map((value) => value.name));
  for (const required of expectedDiscriminators.keys()) {
    if (!typeNames.has(required)) throw new Error(`Pinned Solana 8004 IDL is missing ${required} layout`);
  }
  programDefinitionCache = {
    programId,
    genesisHash: SOLANA_MAINNET_GENESIS_HASH,
    idlHash: actualHash,
    agentAccountDiscriminator: SOLANA_8004_AGENT_ACCOUNT_DISCRIMINATOR,
  };
  return programDefinitionCache;
}
