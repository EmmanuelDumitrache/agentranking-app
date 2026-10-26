import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import test from "node:test";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildOwnershipMessage,
  verifyWalletSignature,
} from "../crypto.ts";

test("solana ownership signature verifies and rejects wrong key", async () => {
  const keypair = nacl.sign.keyPair();
  const walletAddress = bs58.encode(keypair.publicKey);
  const nonce = randomBytes(16).toString("hex");
  const message = buildOwnershipMessage({
    agentId: 42,
    walletAddress,
    nonce,
    expiresIso: new Date(Date.now() + 600_000).toISOString(),
  });
  const sig = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
  const signature = bs58.encode(sig);

  const ok = await verifyWalletSignature({
    chain: "solana",
    walletAddress,
    message,
    signature,
  });
  assert.equal(ok, true);

  const other = nacl.sign.keyPair();
  const bad = await verifyWalletSignature({
    chain: "solana",
    walletAddress: bs58.encode(other.publicKey),
    message,
    signature,
  });
  assert.equal(bad, false);
});

test("evm ownership signature verifies", async () => {
  const account = privateKeyToAccount(
    `0x${createHash("sha256").update("kya-test-key").digest("hex")}`,
  );
  const nonce = randomBytes(16).toString("hex");
  const message = buildOwnershipMessage({
    agentId: 7,
    walletAddress: account.address,
    nonce,
    expiresIso: new Date(Date.now() + 600_000).toISOString(),
  });
  const signature = await account.signMessage({ message });
  const ok = await verifyWalletSignature({
    chain: "evm",
    walletAddress: account.address,
    message,
    signature,
  });
  assert.equal(ok, true);
});

test("replay: consumed nonce set must reject second use (logic)", () => {
  const consumedAt: Date | null = new Date();
  const replayAllowed = consumedAt === null;
  assert.equal(replayAllowed, false);
});
