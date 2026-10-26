import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptProviderCredential,
  encryptProviderCredential,
  ProviderCredentialConfigurationError,
} from "../crypto";

const ENV_NAMES = [
  "LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY",
  "NEXTAUTH_SECRET",
] as const;

const CONTEXT = {
  credentialId: "credential-test-id",
  appAccountId: "account-test-id",
  provider: "google-ai-studio",
};

async function withCredentialEnv(
  values: Partial<Record<(typeof ENV_NAMES)[number], string>>,
  fn: () => void | Promise<void>,
): Promise<void> {
  const previous = new Map(ENV_NAMES.map((name) => [name, process.env[name]] as const));
  try {
    for (const name of ENV_NAMES) delete process.env[name];
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) process.env[name] = value;
    }
    await fn();
  } finally {
    for (const name of ENV_NAMES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("BYOK credentials use one dedicated deployment encryption key", async () => {
  await withCredentialEnv(
    {
      NEXTAUTH_SECRET: "test-nextauth-secret-at-least-32-characters-long",
      LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
    () => {
      const encrypted = encryptProviderCredential("google-test-api-key", CONTEXT);
      assert.equal(encrypted.encryptionVersion, 1);
      assert.equal(
        decryptProviderCredential(
          encrypted.encryptedSecret,
          encrypted.encryptionVersion,
          CONTEXT,
        ),
        "google-test-api-key",
      );
    },
  );
});

test("NEXTAUTH_SECRET is not accepted as BYOK encryption material", async () => {
  await withCredentialEnv(
    { NEXTAUTH_SECRET: "test-nextauth-secret-at-least-32-characters-long" },
    () => {
      assert.throws(
        () => encryptProviderCredential("google-test-api-key", CONTEXT),
        (error: unknown) => {
          assert.ok(error instanceof ProviderCredentialConfigurationError);
          assert.equal(error.code, "missing_key_material");
          assert.match(error.message, /LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY/);
          return true;
        },
      );
    },
  );
});

test("BYOK encryption rejects keys that are not exactly 32 bytes", async () => {
  await withCredentialEnv(
    { LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(31, 4).toString("base64") },
    () => {
      assert.throws(
        () => encryptProviderCredential("google-test-api-key", CONTEXT),
        (error: unknown) => {
          assert.ok(error instanceof ProviderCredentialConfigurationError);
          assert.equal(error.code, "invalid_key");
          assert.match(error.message, /exactly 32 bytes/);
          return true;
        },
      );
    },
  );
});
