"use client";

/** Creates a custodial EVM wallet only after an explicit user action. */
import { useCallback, useRef, useState } from "react";
import { showToast } from "@/components/ui/toast-simple";

export type EvmSetupState = "idle" | "creating" | "persisting" | "done" | "error";
export type EvmSetupResult = {
  address: string;
  privyWalletId?: string | null;
  provider: string;
  isCustodial: boolean;
};
export type EvmSetupHook = {
  state: EvmSetupState;
  error: string | null;
  setupEvmWallet: () => Promise<EvmSetupResult | null>;
  reset: () => void;
};

async function provisionCustodial(agentDbId: number): Promise<EvmSetupResult> {
  const response = await fetch(
    `/api/dashboard/agents/${agentDbId}/evm-wallet/setup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "custodial" }),
    },
  );
  const raw = await response.text();
  let data: Record<string, unknown>;
  try {
    data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Server returned non-JSON (HTTP ${response.status}).`);
  }
  if ((data.ok || data.alreadyConfigured) && typeof data.address === "string") {
    return {
      address: data.address,
      privyWalletId:
        typeof data.privyWalletId === "string" ? data.privyWalletId : null,
      provider: typeof data.provider === "string" ? data.provider : "custodial",
      isCustodial: Boolean(data.isCustodial ?? true),
    };
  }
  throw new Error(
    typeof data.error === "string"
      ? data.error
      : `Wallet setup failed (HTTP ${response.status})`,
  );
}

export function useAgentEvmWalletSetup(agentDbId: number | null): EvmSetupHook {
  const [state, setState] = useState<EvmSetupState>("idle");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const setupEvmWallet = useCallback(async (): Promise<EvmSetupResult | null> => {
    if (agentDbId == null) {
      setError("No agent selected.");
      setState("error");
      return null;
    }
    if (inFlight.current) return null;
    inFlight.current = true;
    setState("creating");
    setError(null);
    try {
      setState("persisting");
      const result = await provisionCustodial(agentDbId);
      setState("done");
      showToast("EVM wallet ready", "success");
      return result;
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "EVM wallet setup failed";
      setError(message);
      setState("error");
      showToast(message, "error");
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [agentDbId]);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return { state, error, setupEvmWallet, reset };
}
