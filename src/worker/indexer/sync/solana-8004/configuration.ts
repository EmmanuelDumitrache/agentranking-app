import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  MPL_CORE_PROGRAM_ID,
  SOLANA_8004_REGISTRY_CONFIG_DISCRIMINATOR,
  SOLANA_8004_REGISTRY_CONFIG_SEED,
  SOLANA_8004_ROOT_CONFIG_DISCRIMINATOR,
  SOLANA_8004_ROOT_CONFIG_SEED,
} from "./constants.js";
import type { Solana8004ProgramDefinition } from "./program.js";
import {
  solanaRpcCall,
  type Solana8004RpcEndpoint,
  type SolanaRpcAccount,
} from "./rpc-client.js";

export type Solana8004ConfigurationEvidence = {
  rootConfigPda: string;
  registryConfigPda: string;
  baseCollection: string;
  authority: string;
  configurationFingerprint: string;
  contextSlot: bigint;
};

type AccountInfoResult = {
  context: { slot: number };
  value: SolanaRpcAccount | null;
};

type DecodedConfig = {
  collection: string;
  authority: string;
  bump: number;
  raw: Uint8Array;
};

function hasDiscriminator(bytes: Uint8Array, discriminator: Uint8Array): boolean {
  return bytes.byteLength >= discriminator.byteLength
    && discriminator.every((value, index) => bytes[index] === value);
}

function decodeCanonicalBase64(account: SolanaRpcAccount, address: string): Uint8Array {
  if (!Array.isArray(account.data) || account.data[1] !== "base64") {
    throw new Error(`${address} did not return base64 account data`);
  }
  const encoded = account.data[0];
  if (typeof encoded !== "string" || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error(`${address} returned malformed base64 account data`);
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded) {
    throw new Error(`${address} returned non-canonical base64 account data`);
  }
  return Uint8Array.from(bytes);
}

function decodeConfigurationAccount(
  account: SolanaRpcAccount,
  address: string,
  programId: string,
  discriminator: Uint8Array,
  label: string,
): DecodedConfig {
  if (account.owner !== programId) {
    throw new Error(`${label} ${address} is owned by ${account.owner}, expected ${programId}`);
  }
  if (account.executable) throw new Error(`${label} ${address} must not be executable`);
  const raw = decodeCanonicalBase64(account, address);
  const requiredLength = 8 + 32 + 32 + 1;
  if (raw.byteLength < requiredLength) {
    throw new Error(`${label} ${address} is truncated (${raw.byteLength} < ${requiredLength})`);
  }
  if (!hasDiscriminator(raw, discriminator)) {
    throw new Error(`${label} ${address} discriminator mismatch`);
  }
  const collection = new PublicKey(raw.slice(8, 40)).toBase58();
  const authority = new PublicKey(raw.slice(40, 72)).toBase58();
  const bump = raw[72]!;
  const padding = raw.slice(requiredLength);
  if (padding.some((value) => value !== 0)) {
    throw new Error(`${label} ${address} has non-zero bytes outside the pinned layout`);
  }
  return { collection, authority, bump, raw };
}

async function fetchConfigurationAccount(input: {
  endpoint: Solana8004RpcEndpoint;
  address: string;
  programId: string;
  discriminator: Uint8Array;
  label: string;
  minContextSlot: bigint;
  signal?: AbortSignal;
}): Promise<{ decoded: DecodedConfig; contextSlot: bigint }> {
  if (input.minContextSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${input.label} minContextSlot exceeds JavaScript safe integer range`);
  }
  const result = await solanaRpcCall<AccountInfoResult>(
    input.endpoint,
    "getAccountInfo",
    [
      input.address,
      {
        commitment: "finalized",
        encoding: "base64",
        minContextSlot: Number(input.minContextSlot),
      },
    ],
    input.signal,
    4 * 1024 * 1024,
  );
  if (!Number.isSafeInteger(result.context?.slot) || BigInt(result.context.slot) < input.minContextSlot) {
    throw new Error(`${input.label} context slot ${String(result.context?.slot)} is below ${input.minContextSlot}`);
  }
  if (!result.value) throw new Error(`${input.label} ${input.address} is missing`);
  return {
    decoded: decodeConfigurationAccount(
      result.value,
      input.address,
      input.programId,
      input.discriminator,
      input.label,
    ),
    contextSlot: BigInt(result.context.slot),
  };
}


async function fetchBaseCollectionAccount(input: {
  endpoint: Solana8004RpcEndpoint;
  address: string;
  minContextSlot: bigint;
  signal?: AbortSignal;
}): Promise<{ raw: Uint8Array; contextSlot: bigint }> {
  if (input.minContextSlot > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("MPL Core base collection minContextSlot exceeds JavaScript safe integer range");
  }
  const result = await solanaRpcCall<AccountInfoResult>(
    input.endpoint,
    "getAccountInfo",
    [
      input.address,
      {
        commitment: "finalized",
        encoding: "base64",
        minContextSlot: Number(input.minContextSlot),
      },
    ],
    input.signal,
    16 * 1024 * 1024,
  );
  if (!Number.isSafeInteger(result.context?.slot) || BigInt(result.context.slot) < input.minContextSlot) {
    throw new Error(
      `MPL Core base collection context slot ${String(result.context?.slot)} is below ${input.minContextSlot.toString(10)}`,
    );
  }
  if (!result.value) throw new Error(`MPL Core base collection ${input.address} is missing`);
  if (result.value.owner !== MPL_CORE_PROGRAM_ID) {
    throw new Error(
      `base collection ${input.address} is owned by ${result.value.owner}, expected ${MPL_CORE_PROGRAM_ID}`,
    );
  }
  if (result.value.executable) throw new Error(`MPL Core base collection ${input.address} must not be executable`);
  const raw = decodeCanonicalBase64(result.value, input.address);
  if (raw.byteLength === 0) throw new Error(`MPL Core base collection ${input.address} has empty account data`);
  return { raw, contextSlot: BigInt(result.context.slot) };
}

export async function loadSolana8004Configuration(input: {
  endpoint: Solana8004RpcEndpoint;
  program: Solana8004ProgramDefinition;
  signal?: AbortSignal;
}): Promise<Solana8004ConfigurationEvidence> {
  const programKey = new PublicKey(input.program.programId);
  const [rootConfigKey, rootConfigBump] = PublicKey.findProgramAddressSync(
    [SOLANA_8004_ROOT_CONFIG_SEED],
    programKey,
  );
  const rootConfigPda = rootConfigKey.toBase58();
  const root = await fetchConfigurationAccount({
    endpoint: input.endpoint,
    address: rootConfigPda,
    programId: input.program.programId,
    discriminator: SOLANA_8004_ROOT_CONFIG_DISCRIMINATOR,
    label: "Solana 8004 RootConfig",
    minContextSlot: input.endpoint.validationSlot,
    signal: input.signal,
  });

  if (root.decoded.bump !== rootConfigBump) {
    throw new Error(
      `Solana 8004 RootConfig bump ${root.decoded.bump} does not match derived bump ${rootConfigBump}`,
    );
  }

  const baseCollectionKey = new PublicKey(root.decoded.collection);
  const [registryConfigKey, registryConfigBump] = PublicKey.findProgramAddressSync(
    [SOLANA_8004_REGISTRY_CONFIG_SEED, baseCollectionKey.toBuffer()],
    programKey,
  );
  const registryConfigPda = registryConfigKey.toBase58();
  const registry = await fetchConfigurationAccount({
    endpoint: input.endpoint,
    address: registryConfigPda,
    programId: input.program.programId,
    discriminator: SOLANA_8004_REGISTRY_CONFIG_DISCRIMINATOR,
    label: "Solana 8004 RegistryConfig",
    minContextSlot: root.contextSlot,
    signal: input.signal,
  });
  if (registry.decoded.bump !== registryConfigBump) {
    throw new Error(
      `Solana 8004 RegistryConfig bump ${registry.decoded.bump} does not match derived bump ${registryConfigBump}`,
    );
  }
  if (registry.decoded.collection !== root.decoded.collection) {
    throw new Error(
      `Solana 8004 RegistryConfig collection ${registry.decoded.collection} does not match RootConfig base collection ${root.decoded.collection}`,
    );
  }
  if (registry.decoded.authority !== root.decoded.authority) {
    throw new Error(
      `Solana 8004 RegistryConfig authority ${registry.decoded.authority} does not match RootConfig authority ${root.decoded.authority}`,
    );
  }
  const baseCollection = await fetchBaseCollectionAccount({
    endpoint: input.endpoint,
    address: root.decoded.collection,
    minContextSlot: registry.contextSlot,
    signal: input.signal,
  });

  const contextSlot = [root.contextSlot, registry.contextSlot, baseCollection.contextSlot]
    .reduce((maximum, current) => current > maximum ? current : maximum);
  const configurationFingerprint = createHash("sha256")
    .update(input.program.programId)
    .update("\0")
    .update(input.endpoint.genesisHash)
    .update("\0")
    .update(rootConfigPda)
    .update("\0")
    .update(root.decoded.raw)
    .update("\0")
    .update(registryConfigPda)
    .update("\0")
    .update(registry.decoded.raw)
    .update("\0")
    .update(root.decoded.collection)
    .update("\0")
    .update(baseCollection.raw)
    .digest("hex");

  return {
    rootConfigPda,
    registryConfigPda,
    baseCollection: root.decoded.collection,
    authority: registry.decoded.authority,
    configurationFingerprint,
    contextSlot,
  };
}
