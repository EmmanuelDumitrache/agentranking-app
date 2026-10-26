"use client";
import { useTransientState } from "@/hooks/use-transient-state";

import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
export function DocsCopyButton({
  value,
  className,
  label = "Copy",
}: {
  readonly value: string;
  readonly className?: string;
  readonly label?: string;
}) {
  const [copied, setCopied] = useTransientState(false, 2000);
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn("docs-copy-button", className)}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}