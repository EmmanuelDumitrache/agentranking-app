/**
 * Standalone copy-trade worker.
 * Polls active AgentCopyTradeConfig leaders and mirrors spot trades
 * onto agent custodial wallets via Jupiter.
 *
 * Run: pnpm run start:copy-trade
 * PM2:  pm2 start "pnpm run start:copy-trade" --name agent-copy-trade
 */
import { getAgentCopyTradeEngine } from "@/lib/agent-trading/copy-trade/engine";

async function main(): Promise<void> {
  if (process.env.DEMO_MODE === "true") {
    console.info("[copy-trade] DEMO_MODE=true: trade mirroring is disabled; exiting");
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  if (!process.env.CUSTODIAL_WALLET_ENCRYPTION_KEY?.trim()) {
    console.warn(
      "[copy-trade] CUSTODIAL_WALLET_ENCRYPTION_KEY missing — mirrors will fail to sign",
    );
  }

  const engine = getAgentCopyTradeEngine();
  engine.start();

  const shutdown = async (signal: string) => {
    console.info(`[copy-trade] received ${signal}, shutting down…`);
    await engine.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("[copy-trade] fatal", error);
  process.exit(1);
});
