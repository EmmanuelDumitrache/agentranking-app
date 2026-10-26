"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  DevnetAddressLink,
  DevnetTxLink,
} from "@/components/agent-launch/devnet-explorer-links";
import { AgentLaunchWalletCard } from "@/components/agent-launch/agent-launch-wallet-card";
import { useAgentLaunchWallet } from "@/hooks/use-agent-launch-wallet";
import { requestDevnetAirdrop } from "@/lib/agent-launch/wallet-client";
import { metadataProviderLabel } from "@/lib/agent-launch/metadata-provider-display";
import { requestAgentLaunchFeeDistribution } from "@/lib/agent-launch/fee-distribution-client";
import type { AgentLaunchCommandCenterSnapshot } from "@/lib/agent-launch/command-center-types";
type Props = {
  snapshot: AgentLaunchCommandCenterSnapshot;
};
function formatLamports(raw: string | null): string {
  if (!raw) return "—";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return `${(n / 1e9).toFixed(6)} SOL (${raw} lamports)`;
}
export function AgentLaunchCommandCenterClient({ snapshot }: Props) {
  const wallet = useAgentLaunchWallet();
  const [selectedLaunchId, setSelectedLaunchId] = useState(
    snapshot.launches[0]?.id ?? "",
  );
  const [devMessage, setDevMessage] = useState<string | null>(null);
  const [devLoading, setDevLoading] = useState(false);
  const selectedLaunch = useMemo(
    () => snapshot.launches.find((l) => l.id === selectedLaunchId) ?? null,
    [snapshot.launches, selectedLaunchId],
  );
  const runDevAction = useCallback(
    async (action: "repair" | "distribution" | "airdrop") => {
      setDevLoading(true);
      setDevMessage(null);
      try {
        if (action === "airdrop") {
          if (!wallet.address) throw new Error("Connect investor wallet first");
          const result = await requestDevnetAirdrop(wallet.address);
          setDevMessage(`Airdrop ok. Balance: ${formatLamports(result.balanceLamports)}`);
          return;
        }
        if (!selectedLaunchId) throw new Error("Select a launch first");
        if (action === "repair") {
          const res = await fetch("/api/agent-launch/repair-passport", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ launchId: selectedLaunchId }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Repair failed");
          setDevMessage("Passport repaired.");
          return;
        }
        if (action === "distribution") {
          const data = await requestAgentLaunchFeeDistribution(selectedLaunchId);
          setDevMessage(
            data.timedOut
              ? data.reason ?? "Distribution is still processing; check again shortly."
              : data.status === "distributed"
                ? `Distributed: ${data.txSignature}`
                : `Distribution ${data.status}: ${data.reason ?? data.jobState ?? ""}`,
          );
          return;
        }
      } catch (e) {
        setDevMessage(e instanceof Error ? e.message : "Action failed");
      } finally {
        setDevLoading(false);
      }
    },
    [selectedLaunchId, wallet.address],
  );
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Environment</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Network:</span>{" "}
            {snapshot.featureFlags.network}
          </p>
          <p>
            <span className="text-muted-foreground">NODE_ENV:</span>{" "}
            {snapshot.featureFlags.nodeEnv}
          </p>
          <p>
            <span className="text-muted-foreground">RPC:</span>{" "}
            <code className="text-xs">{snapshot.rpcUrl}</code>
          </p>
          {snapshot.configErrors.length > 0 ? (
            <p className="text-destructive sm:col-span-2">
              Config errors: {snapshot.configErrors.join("; ")}
            </p>
          ) : null}
          <p>
            <span className="text-muted-foreground">Metadata provider:</span>{" "}
            {metadataProviderLabel(snapshot.metadataProvider.active)}
          </p>
          <p>
            <span className="text-muted-foreground">Fee distribution scheduler:</span>{" "}
            {snapshot.featureFlags.feeDistributionEnabled ? "enabled" : "disabled"}
          </p>
          <p>
            <span className="text-muted-foreground">IPFS configured:</span>{" "}
            {snapshot.metadataProvider.ipfsConfigured ? "yes" : "no"}
          </p>
          {snapshot.metadataProvider.ipfsGateway ? (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">IPFS gateway:</span>{" "}
              <code className="text-xs">{snapshot.metadataProvider.ipfsGateway}</code>
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Wallets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">Treasury:</span>{" "}
            {snapshot.treasuryWallet ? (
              <DevnetAddressLink address={snapshot.treasuryWallet} />
            ) : (
              "—"
            )}
          </p>
          <p>
            <span className="text-muted-foreground">Worker fee bot:</span>{" "}
            {snapshot.workerWallet ? (
              <DevnetAddressLink address={snapshot.workerWallet} />
            ) : (
              "—"
            )}
          </p>
          <p>
            <span className="text-muted-foreground">Worker balance:</span>{" "}
            {formatLamports(snapshot.workerBalanceLamports)}
          </p>
          {selectedLaunch?.creatorWallet ? (
            <p>
              <span className="text-muted-foreground">Creator (selected):</span>{" "}
              <DevnetAddressLink address={selectedLaunch.creatorWallet} />
            </p>
          ) : null}
        </CardContent>
      </Card>
      <AgentLaunchWalletCard wallet={wallet} title="Investor wallet (optional)" />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Aggregate fee totals</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href="/launch">New Agent Launch</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <p>
            <span className="text-muted-foreground">AR fees tracked:</span>{" "}
            {snapshot.aggregateTotals.totalArFeesLamports} lamports
          </p>
          <p>
            <span className="text-muted-foreground">Creator fees tracked:</span>{" "}
            {snapshot.aggregateTotals.totalCreatorFeesLamports} lamports
          </p>
          <p>
            <span className="text-muted-foreground">Total distributed:</span>{" "}
            {snapshot.aggregateTotals.totalFeesDistributedLamports} lamports
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Launches ({snapshot.launches.length})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead>
              <tr className="border-b text-xs">
                <th className="py-2 pr-3">Token</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Metadata</th>
                <th className="py-2 pr-3">Fee share</th>
                <th className="py-2 pr-3">Buy/Sell</th>
                <th className="py-2 pr-3">Dists</th>
                <th className="py-2 pr-3">Latest attempt</th>
                <th className="py-2 pr-3">Fees tracked</th>
                <th className="py-2">Links</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.launches.map((launch) => (
                <tr key={launch.id} className="border-b align-top">
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      {launch.tokenName ?? "—"} / {launch.tokenSymbol ?? "—"}
                    </div>
                    <div className="text-muted-foreground font-mono text-xs">{launch.id}</div>
                    {launch.mint ? (
                      <div className="mt-1">
                        <DevnetAddressLink address={launch.mint} />
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{launch.launchStatus}</td>
                  <td className="py-2 pr-3 text-xs">
                    <div className="capitalize">{launch.metadataProvider}</div>
                    <div className="text-muted-foreground mt-1 break-all font-mono">
                      {launch.metadataUri || "—"}
                    </div>
                    <div className="text-muted-foreground break-all font-mono">
                      {launch.passportUri || "—"}
                    </div>
                    <div className="mt-1 flex flex-col gap-0.5">
                      {launch.gatewayMetadataUrl ? (
                        <Link
                          href={launch.gatewayMetadataUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Gateway metadata
                        </Link>
                      ) : null}
                      {launch.gatewayPassportUrl ? (
                        <Link
                          href={launch.gatewayPassportUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          Gateway passport
                        </Link>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{launch.feeSharingStatus}</td>
                  <td className="py-2 pr-3">
                    {launch.buyEventCount}/{launch.sellEventCount}
                  </td>
                  <td className="py-2 pr-3">{launch.distributionCount}</td>
                  <td className="py-2 pr-3 text-xs">
                    <div>{launch.distributionAttemptStatus ?? "—"}</div>
                    {launch.distributionAttemptMode ? (
                      <div className="text-muted-foreground">{launch.distributionAttemptMode}</div>
                    ) : null}
                    {launch.distributionAttemptSignature ? (
                      <DevnetTxLink
                        signature={launch.distributionAttemptSignature}
                        label="Attempt tx"
                      />
                    ) : null}
                    {launch.distributionAttemptError ? (
                      <div
                        className="text-destructive mt-1 max-w-56 break-words"
                        title={launch.distributionAttemptError}
                      >
                        {launch.distributionAttemptError.slice(0, 120)}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    AR {launch.totalArFeesLamports}
                    <br />
                    Creator {launch.totalCreatorFeesLamports}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      {launch.mint ? (
                        <Link
                          href={`/tokens/${launch.mint}`}
                          className="text-primary text-xs underline-offset-2 hover:underline"
                        >
                          Launch page
                        </Link>
                      ) : null}
                      {launch.creationTx ? (
                        <DevnetTxLink signature={launch.creationTx} label="Create tx" />
                      ) : null}
                      {launch.feeShareTx ? (
                        <DevnetTxLink signature={launch.feeShareTx} label="Fee-share tx" />
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshot.launches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No AgentLaunch records yet.</p>
          ) : null}
        </CardContent>
      </Card>
      <details className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Dev actions — local/devnet only. No chain proof beyond existing APIs.
        </summary>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dev-launch-select">Launch for dev actions</Label>
            <select
              id="dev-launch-select"
              className="border-input bg-background w-full max-w-md rounded-md border px-3 py-2 text-sm"
              value={selectedLaunchId}
              onChange={(e) => setSelectedLaunchId(e.target.value)}
            >
              {snapshot.launches.map((launch) => (
                <option key={launch.id} value={launch.id}>
                  {launch.tokenSymbol ?? launch.id} — {launch.launchStatus}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={devLoading || !selectedLaunchId}
              onClick={() => void runDevAction("repair")}
            >
              Repair passport
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={devLoading || !selectedLaunchId}
              onClick={() => void runDevAction("distribution")}
            >
              Run distribution
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={devLoading || !wallet.address}
              onClick={() => void runDevAction("airdrop")}
            >
              Request devnet SOL
            </Button>
          </div>
          {devMessage ? <p className="text-muted-foreground text-sm">{devMessage}</p> : null}
        </div>
      </details>
    </div>
  );
}
