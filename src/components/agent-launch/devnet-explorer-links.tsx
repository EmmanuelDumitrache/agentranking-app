"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  launchAddressExplorerUrl,
  launchTxExplorerUrl,
  shortenSolanaAddress,
} from "@/lib/agent-launch/explorer-links";
type Props = {
  signature: string;
  label?: string;
};
export function DevnetTxLink({ signature, label = "View on Explorer" }: Props) {
  return (
    <Link
      href={launchTxExplorerUrl(signature, "devnet")}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary text-xs underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}
type AddressLinkProps = {
  address: string;
  shorten?: boolean;
};
export function DevnetAddressLink({ address, shorten = true }: AddressLinkProps) {
  const display = shorten ? shortenSolanaAddress(address) : address;
  return (
    <Link
      href={launchAddressExplorerUrl(address, "devnet")}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-primary underline-offset-2 hover:underline"
      title={address}
    >
      {display}
    </Link>
  );
}
export function DevnetTxSignatureRow({
  label,
  signature,
}: {
  label: string;
  signature: string;
}) {
  return (
    <div>
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-xs">{signature}</span>
        <DevnetTxLink signature={signature} />
      </div>
    </div>
  );
}
export function CopyAddressButton({
  address,
  label = "Copy wallet address",
}: {
  address: string;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        void navigator.clipboard.writeText(address);
      }}
    >
      {label}
    </Button>
  );
}