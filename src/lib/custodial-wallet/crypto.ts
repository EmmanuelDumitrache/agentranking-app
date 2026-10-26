import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;

const EncryptedPayloadSchema = z.strictObject({
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});

type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;
export type EncryptedSecretRecord = {
  encryptedSecret: string;
  encryptionKeyId: string;
  encryptionVersion: number;
};
function resolveMasterKey(): Buffer {
  const raw = process.env.CUSTODIAL_WALLET_ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CUSTODIAL_WALLET_ENCRYPTION_KEY is required in production");
    }
    throw new Error(
      "CUSTODIAL_WALLET_ENCRYPTION_KEY is not configured. Generate with: openssl rand -base64 32",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error("CUSTODIAL_WALLET_ENCRYPTION_KEY must decode to exactly 32 bytes (base64)");
  }
  return key;
}
export function encryptSecretBytes(secret: Uint8Array): EncryptedSecretRecord {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, resolveMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
  return {
    encryptedSecret: JSON.stringify(payload),
    encryptionKeyId: process.env.WALLET_ENCRYPTION_KEY_ID?.trim() || "env:v1",
    encryptionVersion: 1,
  };
}
/** Server-only: decrypt custodial wallet secret bytes. Never call from client code. */
export function decryptSecretBytes(encryptedSecret: string): Uint8Array {
  let payload: EncryptedPayload;
  try {
    const raw: unknown = JSON.parse(encryptedSecret);
    const parsed = EncryptedPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Encrypted secret payload is missing required fields");
    }
    payload = parsed.data;
  } catch (error) {
    if (error instanceof Error && error.message === "Encrypted secret payload is missing required fields") {
      throw error;
    }
    throw new Error("Invalid encrypted secret payload");
  }
  const decipher = createDecipheriv(ALGORITHM, resolveMasterKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return new Uint8Array(plaintext);
}