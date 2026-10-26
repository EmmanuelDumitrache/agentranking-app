import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const service = await readFile(
  new URL("../src/lib/llm-provider/credentials/service.ts", import.meta.url),
  "utf8",
);
const credentialCrypto = await readFile(
  new URL("../src/lib/llm-provider/credentials/crypto.ts", import.meta.url),
  "utf8",
);

const modelMatch = /model\s+LlmProviderCredential\s*\{([\s\S]*?)\n\}/m.exec(schema);
if (!modelMatch) {
  throw new Error("LlmProviderCredential model is missing");
}
const model = modelMatch[1];

if (!/@@unique\(\[\s*appAccountId\s*,\s*provider\s*\]\)/.test(model)) {
  throw new Error(
    "BYOK credentials must remain unique per account + provider so multiple providers can be connected concurrently",
  );
}
if (/@@unique\(\[\s*appAccountId\s*\]\)/.test(model)) {
  throw new Error("BYOK credentials must not be globally unique per account");
}
if (/\bencryptionKeyId\b/.test(model)) {
  throw new Error("BYOK credentials must not persist encryption key identifiers");
}

const aggregateMatch = /export async function getAccountByokModels[\s\S]*?\n\}/m.exec(service);
if (!aggregateMatch) {
  throw new Error("getAccountByokModels is missing");
}
const aggregate = aggregateMatch[0];
if (!aggregate.includes("llmProviderCredential.findMany")) {
  throw new Error("getAccountByokModels must load all usable provider credentials, not a single provider");
}
if (!aggregate.includes("modelGroups.flat()")) {
  throw new Error("getAccountByokModels must aggregate model groups from every connected provider");
}

const storeStart = service.indexOf("export async function validateAndStoreProviderCredential");
const revokeStart = service.indexOf("export async function revokeProviderCredential", storeStart);
const storeSection = storeStart >= 0 && revokeStart > storeStart
  ? service.slice(storeStart, revokeStart)
  : "";
if (!storeSection.includes("appAccountId_provider")) {
  throw new Error("BYOK credential writes must target the account + provider composite key");
}

if (credentialCrypto.includes("APPLICATION_SECRET_")) {
  throw new Error(
    "BYOK credential encryption must use only its dedicated LLM provider credential key, not application/MCP secret keys",
  );
}
const credentialEnvReads = credentialCrypto.match(/process\.env\.[A-Z0-9_]+/g) ?? [];
const expectedCredentialEnvRead = "process.env.LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY";
if (
  credentialEnvReads.length !== 1
  || credentialEnvReads[0] !== expectedCredentialEnvRead
) {
  throw new Error(
    "BYOK credential encryption must read exactly LLM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY",
  );
}
if (
  credentialCrypto.includes("LLM_PROVIDER_CREDENTIAL_KEYS")
  || credentialCrypto.includes("LLM_PROVIDER_CREDENTIAL_KEY_ID")
  || credentialCrypto.includes("parseKeyRing")
  || credentialCrypto.includes("resolveKeyRing")
) {
  throw new Error("BYOK credential encryption must not implement key-ring rotation");
}
if (
  service.includes("currentProviderCredentialEncryptionKeyId")
  || /\bencryptionKeyId\b/.test(service)
) {
  throw new Error("BYOK credential reads must not perform key-ID-based lazy rotation");
}

console.log("BYOK multi-provider architecture verified");
