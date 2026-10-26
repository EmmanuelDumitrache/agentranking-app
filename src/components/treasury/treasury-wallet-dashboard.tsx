"use client";

import Link from "next/link";
import {
  StablecoinCardPanel,
  type StablecoinCardPanelInitialData,
} from "@/components/treasury/stablecoin-card-panel";
import { cn } from "@/lib/utils";
import {
  useTreasuryTransactions,
  useTreasuryWalletBalance,
} from "@/components/treasury/treasury-query-hooks";

function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type Balance = {
  balanceUsdcCents: number;
  reservedUsdcCents: number;
  availableUsdcCents: number;
  status: string;
};

type Tx = {
  id: string;
  type: string;
  amountCents: number;
  merchant: string | null;
  category: string | null;
  status: string;
  createdAt: string;
  agent?: { id: number; name: string } | null;
};

type TreasuryWalletDashboardProps = {
  initialData?: {
    balance: Balance | null;
    transactions: Tx[];
    cardPanel: StablecoinCardPanelInitialData;
  } | null;
};

export function TreasuryWalletDashboard({ initialData }: TreasuryWalletDashboardProps) {
  const { data: balanceData, error: balanceError } = useTreasuryWalletBalance({
    initialData: initialData?.balance ? { balance: initialData.balance } : undefined,
  });
  const { data: txData, error: txError } = useTreasuryTransactions(
    { limit: 8 },
    {
      initialData: initialData?.transactions
        ? { items: initialData.transactions }
        : undefined,
    },
  );
  const balance = balanceData?.balance ?? null;
  const txs = txData?.items ?? [];
  const error = balanceError ?? txError;
  const errorMessage = error
    ? error instanceof Error
      ? error.message
      : "Failed to load"
    : null;

  return (
    <div className="ui-page-stack ui-page-stack--narrow space-y-4">
      {errorMessage ? (
        <div className="rounded-md border border-red-300/40 bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <section className="ui-panel ui-panel--stack space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium">AR virtual card</h2>
            <p className="text-xs text-muted-foreground">
              {initialData?.cardPanel?.config?.fundingProvider === "kripicard"
                ? "Kripicard USDT deposits → AR virtual cards"
                : "USDC treasury → agent spend ledger → fiat at merchants"}
            </p>
          </div>
          <Link href="/dashboard/card/manage" className="text-xs underline-offset-2 hover:underline">
            Manage
          </Link>
        </div>
        <StablecoinCardPanel initialData={initialData?.cardPanel ?? undefined} />
      </section>

      <section className="ui-panel ui-panel--stack">
        <p className="text-sm text-muted-foreground">Treasury balance</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">
          {balance ? formatUsd(balance.availableUsdcCents) : "—"}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Total</dt>
            <dd className="tabular-nums">
              {balance ? formatUsd(balance.balanceUsdcCents) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Reserved</dt>
            <dd className="tabular-nums">
              {balance ? formatUsd(balance.reservedUsdcCents) : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="ui-panel ui-panel--stack space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Recent transactions</h2>
          <Link
            href="/dashboard/card/transactions"
            className="text-xs underline-offset-2 hover:underline"
          >
            View all
          </Link>
        </div>
        <ul className="divide-y">
          {txs.length === 0 ? (
            <li className="py-3 text-sm text-muted-foreground">No transactions yet.</li>
          ) : (
            txs.map((tx) => (
              <li key={tx.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium">{tx.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {tx.merchant ?? tx.agent?.name ?? tx.status}
                  </p>
                </div>
                <span
                  className={cn(
                    "tabular-nums",
                    tx.type === "FUNDING" || tx.type === "REFUND"
                      ? "text-emerald-600"
                      : "",
                  )}
                >
                  {tx.type === "FUNDING" || tx.type === "REFUND" ? "+" : "-"}
                  {formatUsd(tx.amountCents)}
                </span>
              </li>
            ))
          )}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">
        On-chain custodial Solana/EVM wallets remain at{" "}
        <Link href="/dashboard/wallet" className="underline-offset-2 hover:underline">
          /dashboard/wallet
        </Link>{" "}
        for launches and transfers. This card balance is the USDC spend rail.
      </p>
    </div>
  );
}
