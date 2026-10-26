"use client";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CopyAddressButton,
  DevnetAddressLink,
} from "@/components/agent-launch/devnet-explorer-links";
import { PhantomDevHostBanner } from "@/components/wallet/phantom-dev-host-banner";
import { DEVNET_FAUCET_URL } from "@/lib/agent-launch/constants-local";
import { phantomFriendlyLocalUrl } from "@/lib/phantom-localhost-hint";
import type { AgentLaunchWalletState } from "@/hooks/use-agent-launch-wallet";
type Props = {
  wallet: AgentLaunchWalletState;
  title?: string;
};
export function AgentLaunchWalletCard({ wallet, title = "Devnet wallet" }: Props) {
  const phantomLocalUrl = useSyncExternalStore(
    () => () => {},
    () => phantomFriendlyLocalUrl(),
    () => null,
  );
  const networkWarning =
    wallet.networkHint === "mainnet-beta" || wallet.networkHint === "testnet"
      ? `Phantom appears to be on ${wallet.networkHint}. Switch to Devnet in Phantom settings before signing.`
      : wallet.networkHint === "unknown" && wallet.connected
        ? "Ensure Phantom is set to Devnet (Settings → Developer Settings → Testnet mode / Devnet)."
        : null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground text-xs">Status</div>
            <div>{wallet.connected ? "Connected" : "Not connected"}</div>
          </div>
          <div>
            <div className="text-muted-foreground text-xs">Network</div>
            <div>devnet (Agent Launch)</div>
          </div>
          {wallet.address ? (
            <div className="sm:col-span-2">
              <div className="text-muted-foreground text-xs">Connected address</div>
              <DevnetAddressLink address={wallet.address} shorten={false} />
            </div>
          ) : null}
        </div>
        {!wallet.phantomAvailable && !phantomLocalUrl ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-amber-900 dark:text-amber-100">
            Phantom extension not detected. Install Phantom, refresh this page, and use{" "}
            <span className="font-mono">http://localhost:3000</span> for local dev.
          </p>
        ) : null}
        {phantomLocalUrl ? <PhantomDevHostBanner /> : null}
        {networkWarning ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-amber-900 dark:text-amber-100">
            {networkWarning}
          </p>
        ) : null}
        {wallet.error ? <p className="text-destructive text-sm">{wallet.error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {!wallet.connected ? (
            <Button
              onClick={() => void wallet.connect()}
              disabled={wallet.connecting || !wallet.phantomAvailable || Boolean(phantomLocalUrl)}
            >
              {wallet.connecting ? "Connecting…" : "Connect Phantom"}
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => void wallet.disconnect()}>
                Disconnect
              </Button>
              {wallet.address ? <CopyAddressButton address={wallet.address} /> : null}
            </>
          )}
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">Need devnet SOL?</div>
          <p className="text-muted-foreground text-xs">
            Use the official faucet or Dev tools airdrop helper. Devnet SOL is fake test SOL.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href={DEVNET_FAUCET_URL} target="_blank" rel="noopener noreferrer">
              Open Solana devnet faucet
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}