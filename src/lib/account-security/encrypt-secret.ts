import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

const EncryptedPayloadSchema = z.strictObject({
  iv: z.string().min(1),
  ciphertext: z.string().min(1),
  tag: z.string().min(1),
});

type EncryptedPayload = z.infer<typeof EncryptedPayloadSchema>;

function resolveMfaKey(): Buffer {
  const secret = process.env.NEXTAUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error("NEXTAUTH_SECRET must be set and at least 32 characters for MFA encryption");
  }
  return createHash("sha256").update(`account-security-totp:v1:${secret}`).digest();
}

/** Encrypt a TOTP shared secret for storage on UserProfile.totpSecretEnc. */
export function encryptTotpSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, resolveMfaKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: tag.toString("base64"),
  };
  return JSON.stringify(payload);
}

export function decryptTotpSecret(encrypted: string): string {
  let payload: EncryptedPayload;
  try {
    const raw: unknown = JSON.parse(encrypted);
    const parsed = EncryptedPayloadSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("TOTP secret payload is missing required fields");
    }
    payload = parsed.data;
  } catch (error) {
    if (error instanceof Error && error.message === "TOTP secret payload is missing required fields") {
      throw error;
    }
    throw new Error("Invalid TOTP secret payload");
  }
  const decipher = createDecipheriv(ALGORITHM, resolveMfaKey(), Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
