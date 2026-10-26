"use client";
import { cn } from "@/lib/utils";
import { METAPLEX_TOKEN_LINKED_LABEL, METAPLEX_INDEXED_BADGE_LABEL, METAPLEX_AGENT_IDENTITY_PLUGIN_LABEL } from "@/lib/metaplex/config";

const METAPLEX_CHIP_CLASS =
  "inline-flex h-6 shrink-0 items-center rounded border border-violet-500/45 bg-violet-950/50 px-1.5 text-[10px] font-mono font-medium leading-none uppercase tracking-tight text-violet-200/90";
const METAPLEX_REGISTERED_CHIP_CLASS =
  "inline-flex h-6 shrink-0 items-center rounded border border-emerald-500/40 bg-emerald-950/40 px-1.5 text-[10px] font-medium leading-none text-emerald-200/90";
const METAPLEX_BOUND_CHIP_CLASS =
  "inline-flex h-6 shrink-0 items-center rounded border border-amber-500/40 bg-amber-950/40 px-1.5 text-[10px] font-medium leading-none text-amber-200/90";
export function MetaplexListingChip({ className }: { readonly className?: string }) {
  return <span className={cn(METAPLEX_CHIP_CLASS, className)}>{METAPLEX_INDEXED_BADGE_LABEL}</span>;
}


export function MetaplexRegisteredChip({ className }: { readonly className?: string }) {
  return (
    <span className={cn(METAPLEX_REGISTERED_CHIP_CLASS, className)}>
      {METAPLEX_AGENT_IDENTITY_PLUGIN_LABEL}
    </span>
  );
}
export function MetaplexBoundTokenChip({ className }: { readonly className?: string }) {
  return (
    <span className={cn(METAPLEX_BOUND_CHIP_CLASS, className)}>{METAPLEX_TOKEN_LINKED_LABEL}</span>
  );
}