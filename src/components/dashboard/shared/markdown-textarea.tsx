"use client";
import { useRef } from "react";
import { Bold, Code, Italic, Link2, List, ListOrdered } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyTextFormat, type TextFormatAction } from "@/lib/markdown/text-format";
import { renderSimpleMarkdown } from "@/lib/markdown/simple-markdown";
type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  rows?: number;
};
const TOOLBAR: Array<{ action: TextFormatAction; label: string; icon: typeof Bold }> = [
  { action: "bold", label: "Bold", icon: Bold },
  { action: "italic", label: "Italic", icon: Italic },
  { action: "code", label: "Inline code", icon: Code },
  { action: "link", label: "Link", icon: Link2 },
  { action: "bullet", label: "Bullet list", icon: List },
  { action: "ordered", label: "Numbered list", icon: ListOrdered },
];
export function DashboardMarkdownTextarea({
  id,
  value,
  onChange,
  maxLength = 2000,
  placeholder,
  className,
  rows = 5,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  function applyFormat(action: TextFormatAction) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { value: nextValue, selectionStart, selectionEnd } = applyTextFormat(
      value,
      textarea.selectionStart,
      textarea.selectionEnd,
      action,
    );
    if (nextValue.length > maxLength) return;
    onChange(nextValue);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
    });
  }
  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/20 p-1">
        {TOOLBAR.map(({ action, label, icon: Icon }) => (
          <button
            key={action}
            type="button"
            title={label}
            aria-label={label}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => applyFormat(action)}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        <span className="ml-auto pr-2 text-[10px] text-muted-foreground hidden sm:inline">
          **bold** · *italic* · lists · links
        </span>
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        rows={rows}
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground min-h-[96px] resize-y"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={maxLength}
        placeholder={placeholder}
      />
      {value.trim() ? (
        <div className="rounded-lg border border-border/60 bg-muted/10 px-3 py-2">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Preview
          </p>
          <div className="text-sm text-muted-foreground space-y-1">{renderSimpleMarkdown(value)}</div>
        </div>
      ) : null}
      <span className="block text-right text-[10px] text-muted-foreground">
        {value.length}/{maxLength}
      </span>
    </div>
  );
}
