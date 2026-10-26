"use client";

import { Check, Copy } from "lucide-react";
import { useTransientState } from "@/hooks/use-transient-state";
import { cn } from "@/lib/utils";

type Props = {
  readonly value: string;
  readonly label: string;
  readonly primary?: boolean;
  readonly className?: string;
  readonly disabled?: boolean;
};

export function CopyCommandButton({
  value,
  label,
  primary = false,
  className,
  disabled = false,
}: Props) {
  const [copied, setCopied] = useTransientState(false, 1600);

  return (
    <button
      type="button"
      disabled={disabled || !value}
      className={cn(
        primary
          ? "landing-v3-btn-primary gap-2"
          : "ui-btn ui-btn-secondary ui-btn-sm ui-btn-fit gap-2",
        className,
      )}
      onClick={() => {
        if (!value) return;
        void navigator.clipboard.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      {copied ? "Copied" : label}
    </button>
  );
}
