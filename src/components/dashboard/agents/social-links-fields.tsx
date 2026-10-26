"use client";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OfficialLinkDefinition, OfficialLinkType } from "@/lib/dashboard/official-links";
type Props = {
  definitions: OfficialLinkDefinition[];
  links: Record<OfficialLinkType, string>;
  disabled?: boolean;
  detectedTypes?: ReadonlySet<OfficialLinkType>;
  onChange: (linkType: OfficialLinkType, url: string) => void;
  onClear: (linkType: OfficialLinkType) => void;
  className?: string;
};
export function DashboardSocialLinksFields({
  definitions,
  links,
  disabled = false,
  detectedTypes,
  onChange,
  onClear,
  className,
}: Props) {
  return (
    <div className={cn("space-y-3", className)}>
      {definitions.map((def) => (
        <div key={def.linkType} className="flex items-end gap-2">
          <label className="flex-1 block text-xs font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              {def.label}
              {detectedTypes?.has(def.linkType) ? (
                <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground">
                  · detected
                </span>
              ) : null}
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={links[def.linkType]}
              disabled={disabled}
              onChange={(event) => onChange(def.linkType, event.target.value)}
              placeholder={def.placeholder}
              inputMode="url"
              autoComplete="off"
            />
          </label>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="shrink-0 h-9 w-9 text-muted-foreground hover:text-destructive"
            disabled={disabled || !links[def.linkType].trim()}
            aria-label={`Remove ${def.label}`}
            onClick={() => onClear(def.linkType)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
