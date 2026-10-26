"use client";
import { useCallback, useMemo, useState } from "react";
import { useSourceDraft } from "@/hooks/use-source-draft";
import { useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { base } from "wagmi/chains";
import { Loader2, Sparkles, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  OPENVECTA_PLAYGROUND_MODELS,
} from "@/lib/inference-providers/openvecta-models";
import { formatModelCatalogLabel } from "@/lib/inference-providers/models-catalog";
import type { InferenceModelCatalogEntry } from "@/lib/inference-providers/types";
import { runOpenVectaChat } from "@/lib/inference-providers/openvecta-chat.client";
import { showToast } from "@/components/ui/toast-simple";
type Props = {
  providerId: string;
  disabled?: boolean;
  catalogModels?: InferenceModelCatalogEntry[] | null;
};
function buildModelOptions(
  catalogModels: InferenceModelCatalogEntry[] | null | undefined,
): Array<{ id: string; label: string }> {
  if (catalogModels && catalogModels.length > 0) {
    return catalogModels.map((model) => ({
      id: model.id,
      label: formatModelCatalogLabel(model),
    }));
  }
  return OPENVECTA_PLAYGROUND_MODELS.map((row) => ({ id: row.id, label: row.label }));
}
export function InferencePlayground({ providerId, disabled, catalogModels }: Props) {
  const { address, chainId, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const modelOptions = useMemo(() => buildModelOptions(catalogModels), [catalogModels]);
  const modelSourceKey = modelOptions.map((option) => option.id).join("\u0000");
  const [model, setModel] = useSourceDraft(
    modelSourceKey,
    modelOptions[0]?.id ?? "glm-4.7-flash",
  );
  const [prompt, setPrompt] = useState("Say hello in one short sentence.");
  const [running, setRunning] = useState(false);
  const [responseText, setResponseText] = useState<string | null>(null);
  const [lastUsage, setLastUsage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onBase = chainId === base.id;
  const canRun = providerId === "openvecta" && isConnected && walletClient && onBase && !disabled && !running;
  const walletHint = useMemo(() => {
    if (!isConnected) return "Connect an EVM wallet to pay via x402 on Base (USDC).";
    if (!onBase) return "Switch to Base mainnet — OpenVecta settles USDC micropayments there.";
    return `Paying from ${address?.slice(0, 6)}…${address?.slice(-4)} on Base. Each run charges a small USDC ceiling (~$0.002+ depending on model/max_tokens).`;
  }, [address, isConnected, onBase]);
  const switchToBase = useCallback(async () => {
    try {
      await switchChainAsync({ chainId: base.id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not switch to Base");
    }
  }, [switchChainAsync]);
  const run = useCallback(async () => {
    if (!walletClient || providerId !== "openvecta") return;
    setRunning(true);
    setError(null);
    setResponseText(null);
    setLastUsage(null);
    try {
      const result = await runOpenVectaChat({
        walletClient,
        model,
        messages: [{ role: "user", content: prompt.trim() }],
      });
      setResponseText(result.text || "(empty response)");
      if (result.usage) {
        setLastUsage(
          `tokens in ${result.usage.prompt_tokens ?? "?"} · out ${result.usage.completion_tokens ?? "?"} · total ${result.usage.total_tokens ?? "?"}`,
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Inference call failed";
      setError(message);
      showToast(message);
    } finally {
      setRunning(false);
    }
  }, [model, prompt, providerId, walletClient]);
  if (providerId !== "openvecta") {
    return (
      <p className="text-muted-foreground text-xs">
        Playground is available for OpenVecta today. More providers coming soon.
      </p>
    );
  }
  return (
    <section className="ui-overview-panel overflow-hidden rounded-xl p-0">
      <div className="ui-overview-panel-header flex items-center gap-2 px-5 py-4">
        <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />
        <div className="font-medium text-sm">Test inference (x402)</div>
      </div>
      <div className="space-y-4 px-5 py-4">
      <p className="text-muted-foreground text-xs">{walletHint}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs">
          <span className="text-muted-foreground">Model</span>
          <select
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={running || disabled}
          >
            {modelOptions.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5 text-xs">
        <span className="text-muted-foreground">Prompt</span>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          disabled={running || disabled}
          className="text-sm"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        {!isConnected ? (
          <Button type="button" variant="secondary" size="sm" disabled>
            <Wallet className="mr-2 h-4 w-4" aria-hidden />
            Connect wallet in header
          </Button>
        ) : !onBase ? (
          <Button type="button" size="sm" onClick={() => void switchToBase()} disabled={running}>
            Switch to Base
          </Button>
        ) : (
          <Button type="button" size="sm" onClick={() => void run()} disabled={!canRun}>
            {running ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                Paying &amp; calling…
              </>
            ) : (
              "Run paid inference"
            )}
          </Button>
        )}
      </div>
      {error ? <p className="text-destructive text-xs">{error}</p> : null}
      {responseText ? (
        <div className="rounded-md border border-border bg-muted p-3 text-sm whitespace-pre-wrap">{responseText}</div>
      ) : null}
      {lastUsage ? <p className="text-muted-foreground text-[11px]">{lastUsage}</p> : null}
      </div>
    </section>
  );
}
