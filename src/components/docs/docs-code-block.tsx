"use client";
import { DocsCopyButton } from "@/components/docs/docs-copy-button";
import { cn } from "@/lib/utils";
export function DocsCodeBlock({
  label,
  code,
  language,
  className,
}: {
  readonly label?: string;
  readonly code: string;
  readonly language?: "bash" | "json" | "http" | "text";
  readonly className?: string;
}) {
  const langLabel = language ?? (label ? undefined : "text");
  return (
    <div className={cn("docs-code", className)}>
      <div className="docs-code-header">
        <span className="truncate uppercase">{label ?? langLabel ?? "code"}</span>
        <DocsCopyButton value={code} />
      </div>
      <pre className="docs-code-body">
        <code>{code}</code>
      </pre>
    </div>
  );
}