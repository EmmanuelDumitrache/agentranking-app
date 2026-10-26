"use client";

import Link from "next/link";
import { listInferenceProviders } from "@/lib/inference-providers/registry";
import { cn } from "@/lib/utils";

type Props = {
  value: string | null;
  onChange: (providerId: string | null) => void;
  disabled?: boolean;
  className?: string;
};

export function InferenceProviderPicker({ value, onChange, disabled, className }: Props) {
  const providers = listInferenceProviders();

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <p className="text-sm font-medium">Inference provider</p>
        <p className="text-muted-foreground text-xs mt-1">
          Optional. Routes agent LLM calls through a partner gateway with x402 and MCP compatibility.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(null)}
          className={cn(
            "rounded-lg border p-3 text-left transition-colors",
            value == null
              ? "border-foreground/30 bg-muted"
              : "border-border bg-card hover:border-foreground/30 hover:bg-muted",
            disabled && "opacity-60 cursor-not-allowed",
          )}
        >
          <div className="text-sm font-medium">None</div>
          <div className="text-muted-foreground text-xs mt-1">Configure inference later in the dashboard.</div>
        </button>
        {providers.map((provider) => {
          const selected = value === provider.id;
          return (
            <button
              key={provider.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(provider.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                selected
                  ? "border-foreground/30 bg-muted"
                  : "border-border bg-card hover:border-foreground/30 hover:bg-muted",
                disabled && "opacity-60 cursor-not-allowed",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{provider.name}</div>
                <div className="flex gap-1">
                  {provider.x402Compatible ? (
                    <span className="rounded bg-emerald-950 px-1.5 py-0.5 text-[10px] text-emerald-300">
                      x402
                    </span>
                  ) : null}
                  {provider.mcpCompatible ? (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      MCP
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="text-muted-foreground text-xs mt-1 line-clamp-2">{provider.description}</p>
            </button>
          );
        })}
      </div>
      {value ? (
        <p className="text-muted-foreground text-xs">
          Learn more in{" "}
          <Link href={`/docs/partners/${value}`} className="text-foreground underline-offset-2 hover:underline">
            partner docs
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
