"use client";
import { useTransientState } from "@/hooks/use-transient-state";
import Image from "next/image";
import { useCallback, useState } from "react";
import { Copy, ExternalLink, QrCode } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getOobeSynapseReferralCodeSegment,
  getOobeSynapseReferralQrPath,
  getOobeSynapseReferralUrl,
} from "@/lib/oobe-synapse-referral-config";
import { cn } from "@/lib/utils";
const stripBtn =
  "inline-flex items-center gap-0.5 rounded border border-border/55 bg-background/50 px-1.5 py-0.5 text-[10px] font-medium leading-none text-emerald-200/90 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 sm:px-2 sm:text-[11px]";
export function SapOobeReferralStrip() {
  const [copied, setCopied] = useTransientState(false, 2000);
  const [qrOpen, setQrOpen] = useState(false);
  const refUrl = getOobeSynapseReferralUrl();
  const refCode = getOobeSynapseReferralCodeSegment(refUrl);
  const qrSrc = getOobeSynapseReferralQrPath();
  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(refCode);
      setCopied(true);
    } catch {
      // Clipboard may be unavailable (non-HTTPS, permissions)
    }
  }, [refCode, setCopied]);
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border border-emerald-500/20 bg-emerald-950/15 px-2 py-0.5 text-[10px] leading-tight text-muted-foreground sm:gap-x-3 sm:py-1 sm:text-[11px]"
      aria-label="OOBE Protocol Synapse referral"
    >
      <p className="min-w-0 flex-1">
        <span className="font-medium text-emerald-200/90">OOBE · Synapse referrals</span>
        <span className="text-border/80" aria-hidden>
          {" "}
          ·{" "}
        </span>
        <span className="opacity-95">Share infrastructure credit with builders.</span>
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-1">
        <button type="button" onClick={() => void copyCode()} className={stripBtn}>
          <Copy className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          {copied ? "Copied" : "Copy code"}
        </button>
        <a
          href={refUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={stripBtn}
        >
          <ExternalLink className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          Open link
        </a>
        <Dialog open={qrOpen} onOpenChange={setQrOpen}>
          <DialogTrigger asChild>
            <button type="button" className={cn(stripBtn, "cursor-pointer")}>
              <QrCode className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
              QR
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-sm border-emerald-500/25 sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-base">Referral link</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">
                {refUrl}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-3 py-1">
              <div className="rounded-md border border-border/60 bg-white p-2">
                <Image
                  src={qrSrc}
                  alt={`QR code for Synapse referral ${refCode}`}
                  width={180}
                  height={180}
                  className="size-[180px]"
                />
              </div>
              <p className="text-center text-[11px] text-muted-foreground">
                Scan to open your referral on Synapse.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
