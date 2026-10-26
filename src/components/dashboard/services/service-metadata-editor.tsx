"use client";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  metadataItemsFromTextarea,
  metadataItemsToTextarea,
  metadataKeyForServiceTab,
  type EditableServiceMetadataKey,
} from "@/lib/dashboard/service-metadata";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
type Props = {
  agentDbId: number;
  tab: "mcp" | "a2a" | "oasf";
  initialItems: string[];
  /** Values found in on-chain registration (for hints, not placeholders). */
  detectedItems?: string[];
  onSaved: () => void;
  compact?: boolean;
};
const COPY: Record<Props["tab"], { title: string; description: string; emptyHint: string }> = {
  mcp: {
    title: "Published MCP tools",
    description: "Profile metadata only. Private MCP runtime tools are assigned on the agent Connections page and remain independent of this public listing.",
    emptyHint: "Add one tool name per line (e.g. search_agents)",
  },
  a2a: {
    title: "A2A skills",
    description: "Skills shown on your public profile A2A section.",
    emptyHint: "Add one skill per line (e.g. research/summarize)",
  },
  oasf: {
    title: "OASF skills",
    description: "Optional OASF capability list for your public profile.",
    emptyHint: "Add one capability per line",
  },
};
export function DashboardServiceMetadataEditor({
  agentDbId,
  tab,
  initialItems,
  detectedItems = [],
  onSaved,
  compact = false,
}: Props) {
  const initialText = metadataItemsToTextarea(initialItems);
  const [draft, setDraft] = useState({ source: initialText, text: initialText });
  const text = draft.source === initialText ? draft.text : initialText;
  const setText = (nextText: string) => setDraft({ source: initialText, text: nextText });
  const [saving, setSaving] = useState(false);
  const key: EditableServiceMetadataKey = metadataKeyForServiceTab(tab);
  const copy = COPY[tab];
  const storedSet = new Set(initialItems.map((item) => item.toLowerCase()));
  const pendingDetected = detectedItems.filter((item) => !storedSet.has(item.toLowerCase()));
  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/dashboard/agents/${agentDbId}/metadata`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          items: metadataItemsFromTextarea(text),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save metadata");
      showToast("Saved", "success");
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to save", "error");
    } finally {
      setSaving(false);
    }
  }
  function addDetected() {
    const merged = metadataItemsFromTextarea(
      `${text}\n${pendingDetected.join("\n")}`.trim(),
    );
    setText(metadataItemsToTextarea(merged));
  }
  const isDirty =
    metadataItemsToTextarea(metadataItemsFromTextarea(text)) !==
    metadataItemsToTextarea(initialItems);
  return (
    <div className={cn("space-y-3", !compact && "rounded-xl border border-border/60 bg-card/40 p-4")}>
      <div>
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{copy.description}</p>
      </div>
      {pendingDetected.length > 0 ? (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-emerald-300">
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>Detected from registration</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {pendingDetected.map((item) => (
              <span
                key={item}
                className="rounded-md border border-emerald-500/20 bg-background/60 px-2 py-0.5 font-mono text-[11px]"
              >
                {item}
              </span>
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addDetected}>
            Add detected to list
          </Button>
        </div>
      ) : null}
      <textarea
        className="min-h-[88px] w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-mono leading-relaxed"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={copy.emptyHint}
        spellCheck={false}
      />
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={saving || !isDirty} onClick={() => void save()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Save
        </Button>
        {isDirty ? (
          <span className="text-[10px] text-muted-foreground">Unsaved changes</span>
        ) : null}
      </div>
    </div>
  );
}
