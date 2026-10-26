"use client";
import { useState } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
const SAP_CHIP_CLASS =
  "inline-flex h-6 shrink-0 items-center rounded border border-emerald-500/45 bg-emerald-950/60 px-1.5 text-[10px] font-mono font-medium leading-none uppercase tracking-tight text-emerald-200/90";
function SapExplainerBody({ onClose }: { readonly onClose?: () => void }) {
  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted-foreground text-xs leading-relaxed">
        This agent&apos;s identity and data are verified on-chain via Synapse Agent Protocol (SAP) on Solana. SAP
        provides cryptographic proof of capabilities, pricing, and activity — data that cannot be faked or
        self-reported.
      </p>
      <a
        href="https://explorer.oobeprotocol.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex text-xs font-medium text-emerald-400 hover:text-emerald-300"
      >
        Learn more → explorer.oobeprotocol.ai
      </a>
      {onClose ? (
        <Button type="button" variant="outline" size="sm" className="w-full border-border" onClick={onClose}>
          Close
        </Button>
      ) : null}
    </div>
  );
}
/**
 * Interactive SAP label: popover on md+, bottom sheet on small screens.
 * Use `interactive={false}` in dense lists (same look, no disclosure).
 */
export function SapTag({
  className,
  interactive = true,
}: {
  readonly className?: string;
  readonly interactive?: boolean;
}) {
  const desktop = useMediaQuery("(min-width: 768px)", true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const chip = <span className={cn(SAP_CHIP_CLASS, className)}>SAP</span>;
  if (!interactive) {
    return chip;
  }
  if (desktop) {
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(SAP_CHIP_CLASS, "cursor-pointer ring-offset-background hover:bg-emerald-950/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50", className)}
            aria-label="About Synapse Agent Protocol"
          >
            SAP
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 border-emerald-500/20">
          <PopoverHeader>
            <PopoverTitle className="text-foreground">Synapse Agent Protocol</PopoverTitle>
          </PopoverHeader>
          <SapExplainerBody />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className={cn(SAP_CHIP_CLASS, "cursor-pointer ring-offset-background hover:bg-emerald-950/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50", className)}
          aria-label="About Synapse Agent Protocol"
        >
          SAP
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-xl border-t border-emerald-500/20 max-h-[85vh] overflow-y-auto">
        <SheetHeader className="text-left space-y-2">
          <SheetTitle>Synapse Agent Protocol</SheetTitle>
          <SheetDescription className="sr-only">Synapse Agent Protocol verified listing</SheetDescription>
          <SapExplainerBody onClose={() => setSheetOpen(false)} />
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
/** Non-interactive directory chip (same weight as listing pills). */
export function SapListingChip({ className }: { readonly className?: string }) {
  return <SapTag interactive={false} className={className} />;
}
