"use client";
import { Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
const SERVICE_COLORS: Record<string, string> = {
  MCP: "bg-purple-500/20 text-purple-400 border border-purple-500/30",
  A2A: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
  OASF: "bg-orange-500/20 text-orange-400 border border-orange-500/30",
  WEB: "bg-slate-500/20 text-slate-400 border border-slate-500/30",
  TWITTER: "bg-sky-500/20 text-sky-400 border border-sky-500/30",
  EMAIL: "bg-green-500/20 text-green-400 border border-green-500/30",
  /** SAP synthetic slot — icon is vector (never remote favicon / broken img). */
  X402: "bg-amber-500/15 text-amber-200 border border-amber-500/35",
  "X402-DISCOVERY": "bg-amber-500/10 text-amber-300/90 border border-amber-500/25",
  "X402-RESOURCES": "bg-amber-500/10 text-amber-300/90 border border-amber-500/25",
  XPAY: "bg-cyan-500/15 text-cyan-200 border border-cyan-400/35",
  "XONA-XPAY": "bg-cyan-500/15 text-cyan-200 border border-cyan-400/35",
  CUSTOM: "bg-gray-500/20 text-gray-400 border border-gray-500/30",
};
export function ServiceBadge({ name }: { readonly name: string }) {
  const key = name.trim().toUpperCase();
  const colorClass = SERVICE_COLORS[key] ?? SERVICE_COLORS.CUSTOM;
  if (key === "X402") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
          colorClass
        )}
        title="x402 payment lane (SAP)"
      >
        <Shield className="h-3 w-3 shrink-0 text-amber-300/95" aria-hidden />
        X402
      </span>
    );
  }
  if (key === "XPAY" || key === "XONA-XPAY") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
          colorClass,
        )}
        title="Xona xPay monetization rail"
      >
        <Zap className="h-3 w-3 shrink-0 text-cyan-200" aria-hidden />
        Xona xPay
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", colorClass)}>
      {name}
    </span>
  );
}