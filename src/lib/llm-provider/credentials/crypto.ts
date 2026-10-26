import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { z } from "zod";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const ENCRYPTION_VERSION = 1;

const EncryptedEnvelopeSchema = z.strictObject({
  v: z.literal(1),
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});

type EncryptedEnvelope = z.infer<typeof EncryptedEnvelopeSchema>;

export type ProviderCredentialCiphertext = {
  encryptedSecret: string;
  encryptionVersion: number;
};

export type ProviderCredentialConfigurationErrorCode =
  | "invalid_key"
  | "missing_key_material";

export class ProviderCredentialConfigurationError extends Error {
  readonly code: ProviderCredentialConfigurationErrorCode;

  constructor(code: ProviderCredentialConfigurationErrorCode, message: string) {
    super(message);
    this.name = "ProviderCredentialConfigurationError";
    this.code = code;
  }
}

function resolveEncryptionKey(): Buffer {
  const encoded = process.env.LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!encoded) {
    throw new ProviderCredentialConfigurationError(
      "missing_key_material",
      "Provider BYOK encryption requires LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY",
    );
  }

  const key = /^[0-9a-f]{64}$/i.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64");
  if (key.length !== KEY_BYTES) {
    throw new ProviderCredentialConfigurationError(
      "invalid_key",
      `LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes`,
    );
  }
  return key;
}

function aadFor(input: {
  credentialId: string;
  appAccountId: string;
  provider: string;
}): Buffer {
  return Buffer.from(
    `agentranking:llm-provider-credential:v1:${input.credentialId}:${input.appAccountId}:${input.provider}`,
    "utf8",
  );
}

export function encryptProviderCredential(
  plaintext: string,
  context: { credentialId: string; appAccountId: string; provider: string },
): ProviderCredentialCiphertext {
  if (!plaintext) throw new Error("Provider credential cannot be empty");
  const key = resolveEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(aadFor(context));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedEnvelope = {
    v: ENCRYPTION_VERSION,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
  return {
    encryptedSecret: JSON.stringify(envelope),
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

export function decryptProviderCredential(
  encryptedSecret: string,
  encryptionVersion: number,
  context: { credentialId: string; appAccountId: string; provider: string },
): string {
  if (encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error(
      `Unsupported LLM provider credential encryption version: ${encryptionVersion}`,
    );
  }
  const key = resolveEncryptionKey();
  let envelope: EncryptedEnvelope;
  try {
    const raw: unknown = JSON.parse(encryptedSecret);
    const parsed = EncryptedEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("LLM provider credential ciphertext is malformed");
    }
    envelope = parsed.data;
  } catch (error) {
    if (error instanceof Error && error.message === "LLM provider credential ciphertext is malformed") {
      throw error;
    }
    throw new Error("Invalid LLM provider credential ciphertext");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(aadFor(context));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintProviderCredential(
  provider: string,
  plaintext: string,
): string {
  return createHash("sha256")
    .update("agentranking:llm-provider-fingerprint:v1\0")
    .update(provider)
    .update("\0")
    .update(plaintext)
    .digest("hex");
}

export function displayCredentialFingerprint(fingerprint: string): string {
  return `••••${fingerprint.slice(-8)}`;
}
