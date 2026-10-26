"use client";
import { DocsCopyButton } from "@/components/docs/docs-copy-button";
import { cn } from "@/lib/utils";
export function DocsEndpointCard({
  label,
  value,
  description,
  method,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly description?: string;
  readonly method?: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("docs-endpoint-card", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="docs-micro uppercase tracking-wide">{label}</p>
          {description ? <p className="docs-small mt-1">{description}</p> : null}
        </div>
        <DocsCopyButton value={value} />
      </div>
      <div className="docs-endpoint-row mt-3">
        {method ? <span className="docs-method">{method}</span> : null}
        <code className="docs-endpoint-url">{value}</code>
      </div>
    </div>
  );
}