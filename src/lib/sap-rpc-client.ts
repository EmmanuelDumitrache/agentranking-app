/**
 * Read-only SAP client factory with Synapse primary + optional Solana RPC fallback.
 * Always uses @oobe-protocol-labs/synapse-sap-sdk — never raw program account decoding.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { MAINNET_SAP_PROGRAM_ID } from "@oobe-protocol-labs/synapse-sap-sdk/constants";
import {
  KeypairWallet,
  SapClient,
  SapConnection,
} from "@oobe-protocol-labs/synapse-sap-sdk/core";
import {
  DEFAULT_SAP_PUBLIC_SOLANA_RPC_URL,
  redactRpcUrlForLogs,
  resolveSapFallbackRpcUrl,
  resolveSapPrimaryRpcUrl,
} from "@/lib/sap-rpc-config";

export type SapRpcSource = "synapse" | "fallback";

export type SapReadOnlyClientBundle = {
  client: SapClient;
  connection: Connection;
  rpcSource: SapRpcSource;
  rpcUrlUsed: string;
};

export function resolveSapProgramId(): PublicKey {
  const configured = process.env.SAP_PROGRAM_ID?.trim();
  return configured ? new PublicKey(configured) : MAINNET_SAP_PROGRAM_ID;
}

export function createSapClientForSigner(
  signer: Keypair,
  programPk: PublicKey,
  rpcUrl = resolveSapPrimaryRpcUrl(),
): { client: SapClient; connection: Connection } {
  const sapConnection = SapConnection.fromKeypair(rpcUrl, signer, {
    cluster: "mainnet-beta",
    commitment: "confirmed",
  });

  if (sapConnection.programId.equals(programPk)) {
    return {
      client: sapConnection.client,
      connection: sapConnection.connection,
    };
  }

  const client = SapClient.fromOptions({
    connection: sapConnection.connection,
    commitment: sapConnection.commitment,
    wallet: new KeypairWallet(signer),
    programId: programPk,
  });

  return { client, connection: sapConnection.connection };
}

export function createReadOnlySapClient(
  rpcUrl: string,
  programPk: PublicKey,
): { client: SapClient; connection: Connection } {
  const signer = Keypair.generate();
  // web3.js retries HTTP 429s internally with exponential sleeps by default.
  // The SAP indexer already owns a provider fallback chain, so those hidden
  // retries turn one exhausted endpoint into minutes of retry amplification.
  const connection = new Connection(rpcUrl, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
  });
  const client = SapClient.fromOptions({
    connection,
    commitment: "confirmed",
    wallet: new KeypairWallet(signer),
    programId: programPk,
  });

  return { client, connection };
}

async function probeSapRpc(client: SapClient): Promise<void> {
  await client.agent.fetchGlobalRegistry();
}

/**
 * Connect to a configured Synapse RPC first; on probe failure try SAP_RPC_FALLBACK_URL / SOLANA_RPC_FALLBACK_URL.
 */
export async function createSapClientWithFallback(
  programPk: PublicKey,
): Promise<SapReadOnlyClientBundle> {
  const primaryUrl = resolveSapPrimaryRpcUrl();
  const configuredFallback = resolveSapFallbackRpcUrl();
  const candidates: Array<{ url: string; source: SapRpcSource; label: string }> = [];

  // The hosted default Synapse endpoint currently requires an API key. Avoid a
  // guaranteed 401 probe when neither a key nor an operator-supplied primary
  // URL is configured; a custom SYNAPSE_RPC_URL may intentionally be public.
  if (process.env.SYNAPSE_API_KEY?.trim() || process.env.SYNAPSE_RPC_URL?.trim()) {
    candidates.push({ url: primaryUrl, source: "synapse", label: "synapse" });
  }

  if (configuredFallback) {
    candidates.push({
      url: configuredFallback,
      source: "fallback",
      label: "configured-fallback",
    });
  }

  candidates.push({
    url: DEFAULT_SAP_PUBLIC_SOLANA_RPC_URL,
    source: "fallback",
    label: "public-solana",
  });

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const { client, connection } = createReadOnlySapClient(candidate.url, programPk);
      await probeSapRpc(client);
      console.info(
        `[sap-indexer] RPC connected source=${candidate.source} host=${redactRpcUrlForLogs(candidate.url)} (${candidate.label})`,
      );
      return {
        client,
        connection,
        rpcSource: candidate.source,
        rpcUrlUsed: candidate.url,
      };
    } catch (err) {
      const msg = Error.isError(err) ? err.message : String(err);
      failures.push(`${candidate.label}@${redactRpcUrlForLogs(candidate.url)}: ${msg}`);
      console.warn(`[sap-indexer] RPC probe failed (${candidate.label}):`, msg);
    }
  }

  throw new Error(`All SAP RPC candidates failed: ${failures.join("; ")}`);
}
