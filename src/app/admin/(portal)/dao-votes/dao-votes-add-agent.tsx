"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { showToast } from "@/components/ui/toast-simple";
import { Loader2, Plus } from "lucide-react";
type DaoVotesAdminRow = {
  id: number;
  rank: number;
  name: string;
  image: string;
  chainId: number;
  chainName: string;
  powerScore: number;
  daoVotes: number;
  adminPowerAdjust: number;
  agentId: number;
  profilePath: string;
};
export function DaoVotesAddAgent({
  onApplied,
}: Readonly<{ onApplied: () => Promise<void> }>) {
  const [addOpen, setAddOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [detected, setDetected] = useState<DaoVotesAdminRow | null>(null);
  const [targetPowerInput, setTargetPowerInput] = useState("0");
  const [detectLoading, setDetectLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  async function handleDetect() {
    if (!urlInput.trim()) {
      showToast("Paste an agent URL", "error");
      return;
    }
    setDetectLoading(true);
    setDetected(null);
    try {
      const res = await fetch("/api/admin/dao-votes/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput.trim() }),
      });
      const data = (await res.json()) as { agent?: DaoVotesAdminRow; error?: string };
      if (!res.ok) {
        showToast(data.error || "Could not detect agent", "error");
        return;
      }
      if (data.agent) {
        setDetected(data.agent);
        setTargetPowerInput(String(Math.round(data.agent.daoVotes ?? data.agent.powerScore)));
        showToast("Agent detected", "info");
      }
    } catch {
      showToast("Detect failed", "error");
    } finally {
      setDetectLoading(false);
    }
  }
  async function handleApplyAdd() {
    if (!detected) return;
    const n = Number.parseInt(String(targetPowerInput).trim(), 10);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      showToast("Target reputation score must be a non-negative integer", "error");
      return;
    }
    setApplyLoading(true);
    try {
      const res = await fetch(`/api/admin/dao-votes/${detected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPowerScore: n }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        showToast(data.error || "Could not update reputation score", "error");
        return;
      }
      showToast(`Reputation score set to ${n} for ${detected.name}`, "success");
      setAddOpen(false);
      setUrlInput("");
      setDetected(null);
      setTargetPowerInput("0");
      await onApplied();
    } catch {
      showToast("Save failed", "error");
    } finally {
      setApplyLoading(false);
    }
  }
  return (
    <Popover
      open={addOpen}
      onOpenChange={(o: boolean) => {
        setAddOpen(o);
        if (!o) {
          setDetected(null);
          setUrlInput("");
          setTargetPowerInput("0");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="mr-1 size-4" />
          Add agent
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(100vw-2rem,22rem)] space-y-3" align="end">
        <div className="space-y-1.5">
          <Label htmlFor="agent-url">Agent page URL</Label>
          <Input
            id="agent-url"
            placeholder="https://…/agents/8453/123/current-agent-name"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={detectLoading}
          onClick={handleDetect}
        >
          {detectLoading ? <Loader2 className="size-4 animate-spin" /> : null}
          Detect
        </Button>
        {detected ? (
          <div className="space-y-2 rounded-md border border-border p-2 text-sm">
            <div className="flex items-center gap-2">
              <AgentAvatar
                image={detected.image}
                name={detected.name}
                size="sm"
                className="size-8 shrink-0 rounded-full"
              />
              <span className="font-medium">{detected.name}</span>
            </div>
            <p className="text-muted-foreground text-xs">
              Reputation {Math.round(detected.daoVotes ?? detected.powerScore)} · rank #{detected.rank}
            </p>
            <div className="space-y-1">
              <Label htmlFor="target-power">Target reputation score</Label>
              <Input
                id="target-power"
                type="text"
                inputMode="numeric"
                value={targetPowerInput}
                onChange={(e) => setTargetPowerInput(e.target.value)}
              />
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={applyLoading}
              onClick={handleApplyAdd}
            >
              {applyLoading ? <Loader2 className="size-4 animate-spin" /> : null}
              Save target reputation score
            </Button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}