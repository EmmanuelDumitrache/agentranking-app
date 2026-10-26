import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
type PublicKeyRow = { public_key: string };
export type AgentWalletProvisionRow = {
  id: number;
  listing_registry_source: string;
  chainId: number;
  agent_wallet_id: string | null;
};
/** Load custodial agent wallet pubkey via SQL — avoids Prisma relation when client is stale. */
export async function loadAgentCustodialWalletPublicKey(agentDbId: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<PublicKeyRow[]>`
    SELECT cw.public_key
    FROM "Agent" a
    INNER JOIN custodial_wallets cw ON cw.id = a.agent_wallet_id
    WHERE a.id = ${agentDbId}
    LIMIT 1
  `;
  return rows[0]?.public_key?.trim() || null;
}
export async function loadAgentWalletProvisionRow(
  agentDbId: number,
): Promise<AgentWalletProvisionRow | null> {
  const rows = await prisma.$queryRaw<AgentWalletProvisionRow[]>`
    SELECT id, listing_registry_source, "chainId", agent_wallet_id
    FROM "Agent"
    WHERE id = ${agentDbId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
export async function loadCustodialPublicKeyByWalletId(walletId: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<PublicKeyRow[]>`
    SELECT public_key FROM custodial_wallets WHERE id = ${walletId} LIMIT 1
  `;
  return rows[0]?.public_key?.trim() || null;
}
type WalletIdRow = { agent_wallet_id: string | null };
export async function loadAgentWalletIdInTx(
  tx: Prisma.TransactionClient,
  agentDbId: number,
): Promise<string | null> {
  const rows = await tx.$queryRaw<WalletIdRow[]>`
    SELECT agent_wallet_id FROM "Agent" WHERE id = ${agentDbId} LIMIT 1
  `;
  return rows[0]?.agent_wallet_id?.trim() || null;
}
export async function attachAgentWalletInTx(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  walletId: string,
  publicKey: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Agent"
    SET agent_wallet_id = ${walletId}, owner = ${publicKey}
    WHERE id = ${agentDbId}
  `;
}
type EvmWalletIdRow = { agent_evm_wallet_id: string | null; evm_wallet_address: string | null };
export async function loadAgentEvmWalletIdInTx(
  tx: Prisma.TransactionClient,
  agentDbId: number,
): Promise<string | null> {
  const rows = await tx.$queryRaw<EvmWalletIdRow[]>`
    SELECT agent_evm_wallet_id, evm_wallet_address FROM "Agent" WHERE id = ${agentDbId} LIMIT 1
  `;
  return rows[0]?.agent_evm_wallet_id?.trim() || null;
}
export async function loadAgentCustodialEvmAddress(agentDbId: number): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ public_key: string }[]>`
    SELECT cw.public_key
    FROM "Agent" a
    INNER JOIN custodial_wallets cw ON cw.id = a.agent_evm_wallet_id
    WHERE a.id = ${agentDbId}
    LIMIT 1
  `;
  return rows[0]?.public_key?.trim().toLowerCase() || null;
}
export async function attachAgentEvmWalletInTx(
  tx: Prisma.TransactionClient,
  agentDbId: number,
  walletId: string,
  address: string,
): Promise<void> {
  const normalized = address.toLowerCase();
  await tx.$executeRaw`
    UPDATE "Agent"
    SET
      agent_evm_wallet_id = ${walletId},
      evm_wallet_address = ${normalized},
      evm_wallet_provider = 'custodial',
      evm_wallet_status = 'active',
      evm_wallet_created_at = NOW()
    WHERE id = ${agentDbId}
  `;
}
type AccountWalletIdRow = { account_wallet_id: string | null };
export async function loadAccountWalletIdInTx(
  tx: Prisma.TransactionClient,
  accountId: string,
): Promise<string | null> {
  const rows = await tx.$queryRaw<AccountWalletIdRow[]>`
    SELECT account_wallet_id
    FROM app_accounts
    WHERE id = ${accountId}
    LIMIT 1
    FOR UPDATE
  `;
  return rows[0]?.account_wallet_id?.trim() || null;
}
export async function attachAccountWalletInTx(
  tx: Prisma.TransactionClient,
  accountId: string,
  walletId: string,
): Promise<void> {
  await tx.$executeRaw`
    UPDATE app_accounts SET account_wallet_id = ${walletId} WHERE id = ${accountId}
  `;
}
type AccountWalletRow = {
  account_id: string;
  public_key: string | null;
  platform_credits: number;
  llm_credits: number;
  max_agents: number;
  cached_sol_balance_lamports: bigint | null;
  last_balance_sync_at: Date | null;
};
/** Load app account + custodial account wallet for a UserProfile id. */
export async function loadAppAccountWalletRow(
  userProfileId: number,
): Promise<AccountWalletRow | null> {
  const rows = await prisma.$queryRaw<AccountWalletRow[]>`
    SELECT
      aa.id AS account_id,
      cw.public_key,
      aa.platform_credits,
      aa.llm_credits,
      aa.max_agents,
      aa.cached_sol_balance_lamports,
      aa.last_balance_sync_at
    FROM app_accounts aa
    LEFT JOIN custodial_wallets cw ON cw.id = aa.account_wallet_id
    WHERE aa.user_profile_id = ${userProfileId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
