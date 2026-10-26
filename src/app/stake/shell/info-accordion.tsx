"use client";
import { useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
export type InfoAccordionItem = {
  readonly id: string;
  readonly title: string;
  readonly content: React.ReactNode;
  readonly defaultOpen?: boolean;
};
function AccordionPanel({
  open,
  reduce,
  panelId,
  triggerId,
  content,
}: {
  readonly open: boolean;
  readonly reduce: boolean | null;
  readonly panelId: string;
  readonly triggerId: string;
  readonly content: React.ReactNode;
}) {
  const body = (
    <div className="pb-3 text-[12px] leading-[1.55] text-[var(--ar-text-secondary)]">{content}</div>
  );
  if (reduce) {
    return open ? body : null;
  }
  return (
    <section
      id={panelId}
      aria-labelledby={triggerId}
      aria-hidden={!open}
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
      )}
    >
      <div className="overflow-hidden">{body}</div>
    </section>
  );
}
export function InfoAccordion({
  items,
  className,
}: {
  readonly items: readonly InfoAccordionItem[];
  readonly className?: string;
}) {
  const baseId = useId();
  const reduce = useReducedMotion();
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.defaultOpen).map((i) => i.id)),
  );
  const toggle = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <div className={cn("divide-y divide-[var(--ar-border)]", className)}>
      {items.map((item) => {
        const open = openIds.has(item.id);
        const panelId = `${baseId}-${item.id}-panel`;
        const triggerId = `${baseId}-${item.id}-trigger`;
        return (
          <div key={item.id}>
            <button
              type="button"
              id={triggerId}
              className="flex w-full items-center justify-between gap-3 py-3 text-left transition-colors hover:text-[var(--ar-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(89,156,231,0.4)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ar-bg)]"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(item.id)}
            >
              <span className="text-[13px] font-medium text-[var(--ar-text-primary)]">{item.title}</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-[var(--ar-text-muted)]",
                  !reduce && "transition-transform duration-300",
                  open && "rotate-180",
                )}
                style={reduce ? undefined : { transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
                aria-hidden
              />
            </button>
            <AccordionPanel
              open={open}
              reduce={reduce}
              panelId={panelId}
              triggerId={triggerId}
              content={item.content}
            />
          </div>
        );
      })}
    </div>
  );
}
