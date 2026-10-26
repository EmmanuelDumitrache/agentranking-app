"use client";

import { memo, useCallback, useState, type ReactNode } from "react";
import Image from "next/image";
import { Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CardNetworkMark,
} from "@/components/treasury/card-network-marks";
import { cn } from "@/lib/utils";

export type VirtualCardNetwork = "visa" | "mastercard";

export type VirtualPaymentCardDetails = {
  pan: string;
  cvv: string;
  expiry: string;
  last4?: string;
  cardholderName: string;
  amountDollars?: number;
};

type Props = {
  details: VirtualPaymentCardDetails | null;
  maskedLast4?: string | null;
  /** Visa vs Mastercard mark when switching BIN / issued card. */
  network?: VirtualCardNetwork;
  bin?: string | null;
  loading?: boolean;
  className?: string;
  onReveal?: () => Promise<boolean>;
  /** Reveal PAN/CVV automatically once credentials are loaded. */
  autoRevealOnLoad?: boolean;
  /** Extra actions rendered beside copy buttons (e.g. Freeze). */
  footerActions?: ReactNode;
};

function resolveNetwork(
  network: VirtualCardNetwork | undefined,
  bin: string | null | undefined,
  brandHint?: string | null,
): VirtualCardNetwork {
  if (network === "visa" || network === "mastercard") return network;
  const brand = (brandHint ?? "").toLowerCase();
  if (brand.includes("visa")) return "visa";
  if (brand.includes("master")) return "mastercard";
  const digits = (bin ?? "").replace(/\D/g, "");
  if (digits.startsWith("4")) return "visa";
  if (digits.startsWith("5") || digits.startsWith("2")) return "mastercard";
  return "visa";
}

function formatPan(pan: string): string {
  return pan
    .replace(/\D/g, "")
    .replace(/(\d{4})(?=\d)/g, "$1 ")
    .trim();
}

function maskPan(last4: string | null): string {
  return last4 ? `•••• •••• •••• ${last4}` : "•••• •••• •••• ••••";
}

function ArMark() {
  return (
    <Image
      src="/brand/ar-mark-white.png"
      alt=""
      aria-hidden
      width={28}
      height={23}
      className="h-[22px] w-auto object-contain opacity-95"
      priority={false}
    />
  );
}

function NetworkMark({ network }: { network: VirtualCardNetwork }) {
  return <CardNetworkMark network={network} />;
}

function VirtualPaymentCardComponent({
  details,
  maskedLast4,
  network: networkProp,
  bin,
  loading = false,
  className,
  onReveal,
  autoRevealOnLoad = false,
  footerActions,
}: Props) {
  const network = resolveNetwork(networkProp, bin);
  const hasLiveDetails = Boolean(details?.pan && details?.cvv);
  const canToggle = Boolean(onReveal || hasLiveDetails);
  const revealIdentity = [
    maskedLast4 ?? "",
    details?.last4 ?? "",
    bin ?? "",
    network,
    hasLiveDetails ? "live" : "masked",
    autoRevealOnLoad ? "auto" : "manual",
  ].join("|");

  const [copied, setCopied] = useState<string | null>(null);
  const [revealState, setRevealState] = useState(() => ({
    identity: revealIdentity,
    revealed: autoRevealOnLoad && hasLiveDetails,
  }));
  const [revealing, setRevealing] = useState(false);

  if (revealState.identity !== revealIdentity) {
    setRevealState({
      identity: revealIdentity,
      revealed: autoRevealOnLoad && hasLiveDetails,
    });
  }

  const revealed = revealState.revealed;
  const setRevealed = useCallback((value: boolean) => {
    setRevealState((current) => ({ ...current, revealed: value }));
  }, []);

  const copy = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  }, []);

  const last4 =
    details?.last4 ??
    (details?.pan ? details.pan.slice(-4) : null) ??
    maskedLast4 ??
    (bin ? bin.replace(/\D/g, "").slice(-4) : null);

  const showSecrets = hasLiveDetails && revealed;
  const pan = showSecrets ? formatPan(details!.pan) : maskPan(last4);
  const expiry = showSecrets ? (details?.expiry ?? "••/••") : "••/••";
  const cvv = showSecrets ? details!.cvv : "•••";
  const name = details?.cardholderName ?? "AGENT RANKING";

  let eyeIcon = <Eye className="size-3.5" aria-hidden />;
  if (revealing) {
    eyeIcon = <span className="size-3.5 animate-pulse rounded-full bg-white/50" />;
  } else if (revealed) {
    eyeIcon = <EyeOff className="size-3.5" aria-hidden />;
  }

  const toggleReveal = useCallback(async () => {
    if (revealing) return;

    if (revealed) {
      setRevealed(false);
      return;
    }

    if (!hasLiveDetails && onReveal) {
      setRevealing(true);
      try {
        const ok = await onReveal();
        if (ok) setRevealed(true);
      } finally {
        setRevealing(false);
      }
      return;
    }

    if (hasLiveDetails) {
      setRevealed(true);
    }
  }, [hasLiveDetails, onReveal, revealed, revealing, setRevealed]);

  return (
    <div className={cn("w-full max-w-[420px] space-y-3", className)}>
      <div
        className={cn(
          "relative aspect-[1.586/1] w-full overflow-hidden rounded-[20px] p-6 text-left text-white shadow-2xl",
          "bg-[radial-gradient(ellipse_at_15%_0%,rgba(255,255,255,0.08)_0%,transparent_45%),linear-gradient(145deg,#09090b_0%,#18181b_40%,#27272a_100%)]",
          "ring-1 ring-white/10",
          loading && "animate-pulse",
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_38%,rgba(255,255,255,0.07)_48%,transparent_58%)]"
        />

        <div className="relative flex h-full flex-col justify-between">
          <div className="flex items-center justify-between gap-3">
            <ArMark />
            <div className="flex flex-col items-end justify-center gap-1">
              <span className="text-sm font-semibold leading-none tracking-tight text-white opacity-95">
                AgentRanking
              </span>
              {details?.amountDollars != null ? (
                <p className="text-xs font-medium leading-none text-white/70">
                  ${details.amountDollars.toFixed(2)} limit
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1 py-2">
            <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">
              Card number
            </p>
            <div className="flex items-center gap-2">
              <p
                className={cn(
                  "min-w-0 flex-1 font-mono text-[clamp(1rem,4.2vw,1.45rem)] font-medium tracking-[0.18em] text-white",
                  showSecrets && "select-all",
                )}
              >
                {pan}
              </p>
              {canToggle ? (
                <button
                  type="button"
                  className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white/85 ring-1 ring-white/15 transition hover:bg-white/15 hover:text-white disabled:opacity-50"
                  aria-label={revealed ? "Hide card number" : "Show card number"}
                  disabled={revealing}
                  onClick={() => void toggleReveal()}
                >
                  {eyeIcon}
                </button>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto_auto] items-end gap-4">
              <div className="min-w-0">
                <p className="text-[8px] uppercase tracking-[0.18em] text-white/40">
                  Cardholder
                </p>
                <p className="truncate text-sm font-medium uppercase tracking-wide">
                  {name}
                </p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-[0.18em] text-white/40">
                  Valid thru
                </p>
                <p className="font-mono text-sm font-medium">{expiry}</p>
              </div>
              <div>
                <p className="text-[8px] uppercase tracking-[0.18em] text-white/40">
                  CVV
                </p>
                <p
                  className={cn(
                    "font-mono text-sm font-semibold",
                    showSecrets && "select-all",
                  )}
                >
                  {cvv}
                </p>
              </div>
            </div>

            <div className="flex items-end justify-between gap-3 pt-1">
              <p className="truncate text-[10px] text-white/30">Virtual · Kripicard</p>
              <NetworkMark network={network} />
            </div>
          </div>
        </div>
      </div>

      {hasLiveDetails || footerActions ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {hasLiveDetails ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => void copy("pan", details!.pan.replace(/\D/g, ""))}
              >
                <Copy className="mr-1.5 size-3" />
                {copied === "pan" ? "Copied!" : "Copy number"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => void copy("cvv", details!.cvv)}
              >
                <Copy className="mr-1.5 size-3" />
                {copied === "cvv" ? "Copied!" : "Copy CVV"}
              </Button>
            </>
          ) : null}
          {footerActions}
        </div>
      ) : null}
    </div>
  );
}

type VirtualCardThumbProps = {
  lastFour: string;
  cardholderName?: string | null;
  network?: VirtualCardNetwork;
  bin?: string | null;
  brand?: string | null;
  className?: string;
};

export function VirtualCardThumb({
  lastFour,
  cardholderName,
  network: networkProp,
  bin,
  brand,
  className,
}: VirtualCardThumbProps) {
  const network = resolveNetwork(networkProp, bin, brand);
  const displayName = (cardholderName ?? "AR AGENT").slice(0, 14);

  return (
    <div
      className={cn(
        "relative aspect-[1.586/1] w-[108px] shrink-0 overflow-hidden rounded-[10px] p-2.5 text-white",
        "bg-[radial-gradient(ellipse_at_12%_0%,rgba(255,255,255,0.1)_0%,transparent_50%),linear-gradient(145deg,#09090b_0%,#18181b_42%,#27272a_100%)]",
        "shadow-md shadow-black/30 ring-1 ring-white/12",
        "transition-transform duration-200 group-hover:scale-[1.02]",
        className,
      )}
      aria-hidden
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(118deg,transparent_36%,rgba(255,255,255,0.08)_48%,transparent_60%)]"
      />
      <div
        className="pointer-events-none absolute -right-6 -top-6 size-16 rounded-full bg-white/[0.04] blur-2xl"
      />

      <div className="relative flex h-full flex-col justify-between">
        <div className="flex items-start justify-between gap-1">
          <Image
            src="/brand/ar-mark-white.png"
            alt=""
            width={20}
            height={16}
            className="h-[11px] w-auto object-contain opacity-95"
            priority={false}
          />
          <CardNetworkMark network={network} className="h-[10px] w-auto opacity-90" />
        </div>

        <div
          className="h-[7px] w-[14px] rounded-[2px] bg-gradient-to-br from-white/35 to-white/10 ring-1 ring-white/20"
          aria-hidden
        />

        <div className="space-y-0.5">
          <p className="truncate text-[6px] font-medium uppercase tracking-[0.12em] text-white/55">
            {displayName}
          </p>
          <p className="font-mono text-[9px] font-medium tracking-[0.14em] text-white/95">
            •••• {lastFour}
          </p>
          <p className="font-mono text-[7px] tracking-wider text-white/45">••/••</p>
        </div>
      </div>
    </div>
  );
}

export const VirtualPaymentCard = memo(VirtualPaymentCardComponent);
