"use client";
import { useState } from "react";
import { Check, Copy, Download, Loader2, Share2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { showToast } from "@/components/ui/toast-simple";
import {
  downloadAgentsSharePng,
  type AgentsShareCardInput,
} from "@/lib/public-site/agents-share-card";
const PUBLIC_AGENTS_URL = "https://agentranking.io/agents";
function XIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
type Props = {
  readonly shareInput: AgentsShareCardInput;
};
export function AgentsShareButton({ shareInput }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(PUBLIC_AGENTS_URL);
      setCopied(true);
      showToast("Link copied");
      globalThis.setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast("Could not copy link", "error");
    }
  }
  function openTweet() {
    const url = new URL("https://twitter.com/intent/tweet");
    url.searchParams.set(
      "text",
      [
        "AgentRanking agents",
        "",
        `Total ${shareInput.total} · Verified ${shareInput.verified} · Tokenized ${shareInput.tokenized}`,
        "",
        PUBLIC_AGENTS_URL,
      ].join("\n"),
    );
    globalThis.open(url.toString(), "_blank", "noopener,noreferrer");
    setOpen(false);
  }
  async function generatePng() {
    if (generating) return;
    setGenerating(true);
    try {
      await downloadAgentsSharePng({
        ...shareInput,
        generatedAt: new Date(),
      });
      showToast("Share image downloaded");
      setOpen(false);
    } catch {
      showToast("Could not create share image", "error");
    } finally {
      setGenerating(false);
    }
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-muted/20 px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
          aria-label="Share agent stats"
        >
          <Share2 className="h-4 w-4 shrink-0" aria-hidden />
          <span className="hidden sm:inline">Share</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(100vw-2rem,18rem)] space-y-1 p-2"
      >
        <p className="text-muted-foreground px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide">
          Share agents
        </p>
        <button
          type="button"
          onClick={() => void copyLink()}
          className="hover:bg-muted/60 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-sm transition-colors"
        >
          {copied ? (
            <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
          ) : (
            <Copy className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{copied ? "Copied" : "Copy link"}</span>
            <span className="text-muted-foreground block truncate text-[11px]">
              agentranking.io/agents
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={openTweet}
          className="hover:bg-muted/60 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-sm transition-colors"
        >
          <XIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>
            <span className="block font-medium">Post on X</span>
            <span className="text-muted-foreground block text-[11px]">
              Open a draft with live stats
            </span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => void generatePng()}
          disabled={generating}
          className="hover:bg-muted/60 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-sm transition-colors disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Download className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <span>
            <span className="block font-medium">
              {generating ? "Generating…" : "Download PNG"}
            </span>
            <span className="text-muted-foreground block text-[11px]">
              Social card with activity chart
            </span>
          </span>
        </button>
      </PopoverContent>
    </Popover>
  );
}
