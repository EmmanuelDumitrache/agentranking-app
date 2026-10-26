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

type EncryptionKey = { id: string; key: Buffer };

export type SecretCiphertext = {
  encryptedSecret: string;
  encryptionKeyId: string;
  encryptionVersion: number;
};

function decodeKey(id: string, encoded: string): EncryptionKey {
  const trimmed = encoded.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `Application secret key ${id} must decode to exactly ${KEY_BYTES} bytes`,
    );
  }
  return { id, key };
}

function parseKeyRing(raw: string, envName: string): EncryptionKey[] {
  const keys = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0 || separator === entry.length - 1) {
        throw new Error(
          `${envName} entries must use <key-id>:<base64-or-hex-key>`,
        );
      }
      const id = entry.slice(0, separator).trim();
      const encoded = entry.slice(separator + 1).trim();
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(id)) {
        throw new Error(`Invalid application secret key id: ${id}`);
      }
      return decodeKey(id, encoded);
    });
  if (keys.length === 0) {
    throw new Error(`${envName} did not contain a usable key`);
  }
  const seen = new Set<string>();
  for (const item of keys) {
    if (seen.has(item.id)) {
      throw new Error(`Duplicate application secret key id: ${item.id}`);
    }
    seen.add(item.id);
  }
  return keys;
}

function resolveKeyRing(): EncryptionKey[] {
  const keyRing = process.env.APPLICATION_SECRET_KEYS?.trim();
  if (keyRing) return parseKeyRing(keyRing, "APPLICATION_SECRET_KEYS");

  const single = process.env.APPLICATION_SECRET_ENCRYPTION_KEY?.trim();
  if (single) {
    const id = process.env.APPLICATION_SECRET_KEY_ID?.trim() || "env-v1";
    return [decodeKey(id, single)];
  }

  throw new Error(
    "Application secret encryption requires APPLICATION_SECRET_ENCRYPTION_KEY (or APPLICATION_SECRET_KEYS for key rotation)",
  );
}

function aad(namespace: string, context: readonly string[]): Buffer {
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(namespace)) {
    throw new Error("Invalid secret envelope namespace");
  }
  return Buffer.from(
    ["agentranking", "secret", "v1", namespace, ...context].join(":"),
    "utf8",
  );
}

export function currentSecretEncryptionKeyId(): string {
  return resolveKeyRing()[0]!.id;
}

export function encryptSecret(
  plaintext: string,
  options: { namespace: string; context: readonly string[] },
): SecretCiphertext {
  if (!plaintext) throw new Error("Secret cannot be empty");
  const primary = resolveKeyRing()[0]!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, primary.key, iv);
  cipher.setAAD(aad(options.namespace, options.context));
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
    encryptionKeyId: primary.id,
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

export function decryptSecret(
  encryptedSecret: string,
  encryptionKeyId: string,
  encryptionVersion: number,
  options: { namespace: string; context: readonly string[] },
): string {
  if (encryptionVersion !== ENCRYPTION_VERSION) {
    throw new Error(
      `Unsupported application secret encryption version: ${encryptionVersion}`,
    );
  }
  const key = resolveKeyRing().find((entry) => entry.id === encryptionKeyId);
  if (!key) {
    throw new Error(
      `Application secret encryption key ${encryptionKeyId} is not configured`,
    );
  }
  let envelope: EncryptedEnvelope;
  try {
    const raw: unknown = JSON.parse(encryptedSecret);
    const parsed = EncryptedEnvelopeSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Application secret ciphertext is malformed");
    }
    envelope = parsed.data;
  } catch (error) {
    if (error instanceof Error && error.message === "Application secret ciphertext is malformed") {
      throw error;
    }
    throw new Error("Invalid application secret ciphertext");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    key.key,
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(aad(options.namespace, options.context));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function fingerprintSecret(
  namespace: string,
  plaintext: string,
): string {
  return createHash("sha256")
    .update("agentranking:secret-fingerprint:v1\0")
    .update(namespace)
    .update("\0")
    .update(plaintext)
    .digest("hex");
}
