"use client";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAccount, useWriteContract, useSwitchChain } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  ArrowLeft,
  ArrowRight,
  Plus,
  Trash2,
  Loader2,
  CheckCircle,
  ExternalLink,
  Upload,
  Download,
} from "lucide-react";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { AppBackLink } from "@/components/shared/app-back-link";
import {
  LaunchWizardStepper,
  LaunchWizardPanel,
  LaunchWizardNav,
} from "./launch-wizard-shell";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { ChainBadge } from "@/components/shared/chain-badge";
import { ServiceBadge } from "@/components/shared/service-badge";
import { getChainByChainId, type ChainConfig } from "@/lib/chains";
import { getTxExplorerUrl } from "@/lib/explorer-tx";
import { identityRegistryAbi } from "@/lib/identity-registry-abi";
import { getIdentityRegistryAddress } from "@/lib/identity-registry";
import {
  LAUNCH_STEPS,
  type LaunchStepId,
  createLaunchService,
  canDeployWithWallet,
  LAUNCH_SERVICE_KINDS,
  LAUNCH_SERVICE_HINTS,
  LAUNCH_SERVICE_PLACEHOLDERS,
  LAUNCH_AGENT_TYPES,
  LAUNCH_TRUST_OPTIONS,
  estimateLaunchGasUsd,
  type LaunchServiceEntry,
  type LaunchServiceKind,
} from "@/lib/launch/constants";
import {
  buildLaunchAgentUri,
  buildLaunchRegistrationJson,
  buildLaunchExtraMetadata,
  launchServicesToRegistration,
} from "@/lib/launch/registration";
import {
  dashboardClaimAgentUrl,
  dashboardHomeUrl,
  dashboardAgentsUrl,
} from "@/lib/dashboard/external-urls";
import { timeoutSignal } from "@/lib/timing/abort";
import type { CreateAgentPageConfig } from "@/lib/public-launch/create-agent-config";
import { cn } from "@/lib/utils";
function truncateRegistry(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
function fieldInputClassName(): string {
  return "w-full rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-[var(--ar-bg)] px-2.5 py-1.5 text-sm text-[var(--ar-text-primary)] placeholder:text-[var(--ar-text-muted)] focus:border-[var(--ar-border-strong)] focus:outline-none";
}
function walletErrorMessage(msg: string): string {
  if (msg.includes("User rejected")) return "Transaction was rejected in your wallet.";
  return msg.length > 200 ? `${msg.slice(0, 200)}...` : msg;
}
function ChainSelectCard({
  chain,
  selected,
  onToggle,
}: {
  readonly chain: ChainConfig;
  readonly selected: boolean;
  readonly onToggle: (id: number) => void;
}) {
  const deployable = canDeployWithWallet(chain);
  const registry = typeof chain.identityRegistry === "string" ? chain.identityRegistry : "";
  return (
    <button
      type="button"
      disabled={!deployable}
      onClick={() => deployable && onToggle(chain.chainId)}
      className={cn(
        "launch-wizard-chain-card ar-card text-left transition-colors",
        selected && deployable && "launch-wizard-chain-card--selected",
        !deployable && "cursor-not-allowed opacity-50",
      )}
    >
      <div className="flex items-start gap-3">
        <ChainBadge name={chain.shortName} color={chain.color} icon={chain.icon} iconOnly size="md" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--ar-text-primary)]">{chain.name}</p>
          <p className="text-xs text-[var(--ar-text-muted)]">Chain ID {chain.chainId}</p>
          <p className="mt-1 font-mono text-[10px] text-[var(--ar-text-tertiary)]">
            {registry ? truncateRegistry(registry) : "No wallet deploy"}
          </p>
        </div>
        {selected && deployable ? <CheckCircle className="h-4 w-4 shrink-0 text-emerald-400" /> : null}
      </div>
    </button>
  );
}
export function CreatePageClient({
  config,
}: {
  readonly config: CreateAgentPageConfig;
}) {
  const [step, setStep] = useState<LaunchStepId>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [services, setServices] = useState<LaunchServiceEntry[]>([createLaunchService("MCP")]);
  const [oasfSkills, setOasfSkills] = useState("");
  const [oasfDomains, setOasfDomains] = useState("");
  const [agentType, setAgentType] = useState("");
  const [isTEE, setIsTEE] = useState(false);
  const [stakedAmount, setStakedAmount] = useState("");
  const [agentTags, setAgentTags] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [x402Support, setX402Support] = useState(false);
  const [supportedTrust, setSupportedTrust] = useState<string[]>(["reputation"]);
  const [uriMode, setUriMode] = useState<"auto" | "ipfs">("auto");
  const [ipfsUrl, setIpfsUrl] = useState("");
  const [selectedChainIds, setSelectedChainIds] = useState<number[]>([8453]);
  const [serviceDraftKind, setServiceDraftKind] = useState<LaunchServiceKind>("MCP");
  const [deployQueueIndex, setDeployQueueIndex] = useState(0);
  const [registeredAgentId, setRegisteredAgentId] = useState<number | null>(null);
  const [registeredProfilePath, setRegisteredProfilePath] = useState<string | null>(null);
  const [dbInserted, setDbInserted] = useState(false);
  const [insertError, setInsertError] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [recoverTxHash, setRecoverTxHash] = useState("");
  const [recoverChainId, setRecoverChainId] = useState(11155111);
  const finalizeInFlightRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const { address, isConnected, chain: walletChain } = useAccount();
  const { switchChain, isPending: isSwitchPending, error: switchError } = useSwitchChain();
  const { writeContract, data: txHash, isPending: isWritePending, error: writeError, reset: resetWrite } =
    useWriteContract();
  const deployableChainIds = useMemo(
    () =>
      selectedChainIds.filter((id) => {
        const chain = getChainByChainId(id);
        return chain && canDeployWithWallet(chain);
      }),
    [selectedChainIds],
  );
  const chainId = deployableChainIds[deployQueueIndex] ?? deployableChainIds[0] ?? 8453;
  const selectedChain = getChainByChainId(chainId);
  const remainingDeployChains = deployableChainIds.length - deployQueueIndex - 1;
  const advancedState = useMemo(
    () => ({
      agentType,
      agentTags,
      isTEE,
      stakedAmount,
      isActive,
      x402Support,
      supportedTrust,
    }),
    [agentTags, agentType, isActive, isTEE, stakedAmount, supportedTrust, x402Support],
  );
  const capabilitiesState = useMemo(
    () => ({ oasfSkills, oasfDomains }),
    [oasfDomains, oasfSkills],
  );
  const registrationInput = useMemo(
    () => ({
      name,
      description,
      imageUrl,
      services,
      capabilities: capabilitiesState,
      advanced: advancedState,
    }),
    [advancedState, capabilitiesState, description, imageUrl, name, services],
  );
  const registrationJson = useMemo(
    () => buildLaunchRegistrationJson(registrationInput),
    [registrationInput],
  );
  const registrationJsonText = useMemo(() => JSON.stringify(registrationJson, null, 2), [registrationJson]);
  const metadataBytes = useMemo(
    () => new Blob([JSON.stringify(registrationJson)]).size,
    [registrationJson],
  );
  const resolvedAgentId = registeredAgentId;
  const resolvedProfilePath = registeredProfilePath;
  const isLaunchComplete = resolvedAgentId !== null || dbInserted;
  const isSyncing = Boolean(txHash && !isLaunchComplete);
  const isStep1Valid = name.trim().length > 0 && description.trim().length > 0;
  const isStep6Valid = deployableChainIds.length > 0;
  const needsChainSwitch = isConnected && walletChain?.id !== chainId;
  const explorerUrl = txHash ? getTxExplorerUrl(chainId, txHash) : null;
  const buildRegisterPayload = useCallback(
    (overrides?: { chainId?: number; txHash?: string; recovery?: boolean }) => {
      const extraMeta = buildLaunchExtraMetadata(advancedState);
      const serviceRows = launchServicesToRegistration(services, capabilitiesState);
      const payload: Record<string, unknown> = {
        chainId: overrides?.chainId ?? chainId,
        txHash: overrides?.txHash ?? txHash ?? "",
        owner: address ?? "",
      };
      if (!overrides?.recovery || name.trim()) payload.name = name;
      if (!overrides?.recovery || description.trim()) payload.description = description;
      if (!overrides?.recovery || imageUrl.trim()) payload.image = imageUrl;
      if (!overrides?.recovery || serviceRows.length > 0) payload.services = serviceRows;
      if (Object.keys(extraMeta).length > 0) {
        payload.metadata = Object.entries(extraMeta).map(([key, value]) => ({ key, value }));
      }
      return payload;
    },
    [address, advancedState, capabilitiesState, chainId, description, imageUrl, name, services, txHash],
  );
  const finalizeFromTx = useCallback(
    async (
      hashOverride?: string,
      options?: { chainId?: number; recovery?: boolean; signal?: AbortSignal },
    ) => {
      const hash = (hashOverride ?? txHash)?.trim();
      if (!hash || !address || finalizeInFlightRef.current) return null;
      finalizeInFlightRef.current = true;
      setIsFinalizing(true);
      setInsertError(null);
      try {
        const requestSignal = timeoutSignal(30_000, options?.signal);
        const res = await fetch("/api/agents/register-from-tx", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            buildRegisterPayload({
              chainId: options?.chainId,
              txHash: hash,
              recovery: options?.recovery,
            }),
          ),
          signal: requestSignal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          agent?: { agentId?: number; profilePath?: string };
        };
        if (
          res.ok &&
          data.success &&
          data.agent?.agentId != null &&
          typeof data.agent.profilePath === "string"
        ) {
          setRegisteredAgentId(data.agent.agentId);
          setRegisteredProfilePath(data.agent.profilePath);
          setDbInserted(true);
          return data.agent.agentId;
        }
        setInsertError(data.error ?? `Could not finalize registration (${res.status})`);
        return null;
      } catch (error) {
        if (options?.signal?.aborted) return null;
        console.error("[launch] register-from-tx failed", error);
        setInsertError(
          error instanceof DOMException && error.name === "TimeoutError"
            ? "Registration finalization timed out. Retrying is safe."
            : "Could not finalize registration. Please try again.",
        );
        return null;
      } finally {
        finalizeInFlightRef.current = false;
        setIsFinalizing(false);
      }
    },
    [address, buildRegisterPayload, txHash],
  );
  useEffect(() => {
    if (!txHash || !address || isLaunchComplete) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async (attempt: number) => {
      if (controller.signal.aborted || isLaunchComplete) return;
      const agentId = await finalizeFromTx(undefined, { signal: controller.signal });
      if (controller.signal.aborted || agentId != null) return;
      if (attempt < 18) {
        timer = setTimeout(() => void poll(attempt + 1), 5_000);
      } else {
        setInsertError(
          "On-chain registration succeeded but directory sync is slow. Use Recover below with your tx hash.",
        );
      }
    };
    timer = setTimeout(() => void poll(0), 2_000);
    return () => {
      controller.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [address, finalizeFromTx, isLaunchComplete, txHash]);
  const handleImageUpload = useCallback(async (file: File) => {
    setImageUploading(true);
    setImageUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/agent-image", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Upload failed");
      }
      const { url } = (await res.json()) as { url: string };
      setImageUrl(url);
    } catch (err) {
      setImageUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setImageUploading(false);
    }
  }, []);
  const handleRegister = () => {
    const uri = buildLaunchAgentUri(registrationInput, uriMode, ipfsUrl);
    writeContract({
      address: getIdentityRegistryAddress(chainId),
      abi: identityRegistryAbi,
      functionName: "register",
      args: [uri],
      chainId,
    });
  };
  const handleDeployNextChain = () => {
    setDeployQueueIndex((i) => i + 1);
    setRegisteredAgentId(null);
    setDbInserted(false);
    setInsertError(null);
    resetWrite();
  };
  const toggleChain = (id: number) => {
    setSelectedChainIds((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((c) => c !== id) : prev) : [...prev, id],
    );
  };
  const toggleTrust = (id: string) => {
    setSupportedTrust((prev) =>
      prev.includes(id) ? (prev.length > 1 ? prev.filter((t) => t !== id) : prev) : [...prev, id],
    );
  };
  const addService = () => setServices((prev) => [...prev, createLaunchService(serviceDraftKind)]);
  const removeService = (id: string) =>
    setServices((prev) => (prev.length > 1 ? prev.filter((s) => s.id !== id) : prev));
  const updateService = (id: string, patch: Partial<LaunchServiceEntry>) =>
    setServices((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const canReach = (target: LaunchStepId): boolean => {
    if (target <= step) return true;
    if (!isStep1Valid) return false;
    if (target >= 6 && !isStep6Valid) return false;
    return isStep1Valid;
  };
  const goToStep = (target: LaunchStepId) => {
    if (canReach(target) || target === step) setStep(target);
  };
  const nextStep = () => {
    if (step < 7) setStep((step + 1) as LaunchStepId);
  };
  const prevStep = () => {
    if (step > 1) setStep((step - 1) as LaunchStepId);
  };
  const nextDisabled =
    (step === 1 && !isStep1Valid) || (step === 6 && !isStep6Valid);
  const nextLabel =
    step < 7 ? `Next: ${LAUNCH_STEPS.find((s) => s.id === step + 1)?.label ?? "Continue"}` : "Review";
  const downloadRegistrationJson = () => {
    const blob = new Blob([registrationJsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name.trim() || "agent"}-registration.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const renderDeploySection = () => (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-2.5">
        <span className="text-xs text-[var(--ar-text-muted)]">Estimated gas</span>
        <span className="text-xs font-medium text-[var(--ar-text-primary)]">
          {estimateLaunchGasUsd(chainId)}
        </span>
      </div>
      {isConnected ? null : (
        <div className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-4 text-center">
          <p className="mb-3 text-sm text-[var(--ar-text-muted)]">Connect your wallet to create an agent</p>
          <ConnectButton />
        </div>
      )}
      {needsChainSwitch ? (
        <div className="rounded-[var(--ar-radius)] border border-amber-500/30 bg-amber-500/5 p-3">
          <p className="mb-2 text-xs text-amber-300">
            Your wallet is on {walletChain?.name ?? "a different chain"}. Switch to {selectedChain?.name}.
          </p>
          {switchError ? (
            <p className="mb-2 text-xs text-red-400">{walletErrorMessage(switchError.message)}</p>
          ) : null}
          <button
            type="button"
            className="ar-btn ar-btn-secondary"
            onClick={() => switchChain({ chainId })}
            disabled={isSwitchPending}
          >
            {isSwitchPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Switching...
              </>
            ) : (
              <>Switch to {selectedChain?.name}</>
            )}
          </button>
        </div>
      ) : null}
      {isFinalizing && txHash && !resolvedAgentId ? (
        <div className="rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-4">
          <div className="flex items-center gap-2 text-sm text-[var(--ar-text-primary)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Finalizing registration on {selectedChain?.name}...
          </div>
          <p className="mt-2 text-xs text-[var(--ar-text-muted)]">
            Your transaction succeeded. We&apos;re syncing your agent to the directory.
          </p>
        </div>
      ) : null}
      {isLaunchComplete && resolvedAgentId !== null ? (
        <div className="rounded-[var(--ar-radius)] border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">Agent Created!</span>
          </div>
          <p className="mb-3 text-xs text-[var(--ar-text-muted)]">
            Your agent <strong className="text-[var(--ar-text-primary)]">{name}</strong> (ID #
            {resolvedAgentId}) is live on {selectedChain?.name}.
          </p>
          {insertError ? (
            <div className="mb-3 rounded-[var(--ar-radius)] border border-red-500/30 bg-red-500/5 p-3">
              <p className="mb-2 text-xs text-red-400">{insertError}</p>
              <button type="button" className="ar-btn ar-btn-secondary" onClick={() => void finalizeFromTx()}>
                Retry sync
              </button>
            </div>
          ) : null}
          <div className="mb-3 flex items-center gap-3 rounded-[var(--ar-radius)] bg-[var(--ar-bg)]/50 p-2">
            <AgentAvatar image={imageUrl || null} name={name} size="sm" className="shrink-0 rounded-lg" />
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-medium">{name}</span>
              {selectedChain ? (
                <ChainBadge
                  name={selectedChain.shortName}
                  color={selectedChain.color}
                  icon={selectedChain.icon}
                  size="sm"
                />
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {resolvedProfilePath ? (
              <>
                <Link
                  href={resolvedProfilePath}
                  className="ar-link inline-flex items-center gap-1 text-xs font-medium"
                >
                  View agent <ArrowRight className="h-3 w-3" />
                </Link>
                <a
                  href={dashboardClaimAgentUrl(resolvedProfilePath)}
                  className="ar-link inline-flex items-center gap-1 text-xs font-medium"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Dashboard verify <ExternalLink className="h-3 w-3" />
                </a>
              </>
            ) : null}
            <a
              href={dashboardAgentsUrl()}
              className="ar-link inline-flex items-center gap-1 text-xs font-medium"
              target="_blank"
              rel="noopener noreferrer"
            >
              My agents <ExternalLink className="h-3 w-3" />
            </a>
            <a
              href={dashboardHomeUrl()}
              className="ar-link inline-flex items-center gap-1 text-xs font-medium"
              target="_blank"
              rel="noopener noreferrer"
            >
              Agent Dashboard <ExternalLink className="h-3 w-3" />
            </a>
            {explorerUrl ? (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ar-link inline-flex items-center gap-1 text-xs font-medium"
              >
                View transaction <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
          {remainingDeployChains > 0 ? (
            <div className="mt-4 border-t border-[var(--ar-border)] pt-3">
              <p className="mb-2 text-xs text-[var(--ar-text-muted)]">
                {remainingDeployChains} more network{remainingDeployChains === 1 ? "" : "s"} selected.
              </p>
              <button type="button" className="ar-btn ar-btn-primary" onClick={handleDeployNextChain}>
                Register on next chain
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {isSyncing ? (
        <div className="space-y-2 rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--ar-text-primary)]" />
            <span className="text-xs text-[var(--ar-text-muted)]">
              Transaction submitted — syncing agent to directory...
            </span>
          </div>
          {insertError ? <p className="text-xs text-amber-300">{insertError}</p> : null}
          {txHash && explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ar-link inline-flex items-center gap-1 text-xs"
            >
              View on block explorer <ExternalLink className="h-3 w-3" />
            </a>
          ) : null}
          {txHash ? (
            <button
              type="button"
              className="ar-btn ar-btn-secondary mt-2 text-xs"
              disabled={isFinalizing || !address}
              onClick={() => void finalizeFromTx()}
            >
              {isFinalizing ? "Syncing..." : "Sync now"}
            </button>
          ) : null}
        </div>
      ) : null}
      {writeError ? (
        <div className="rounded-[var(--ar-radius)] border border-red-500/30 bg-red-500/5 p-3">
          <p className="text-xs text-red-400">{walletErrorMessage(writeError.message)}</p>
          <button type="button" className="ar-btn ar-btn-secondary mt-2 text-xs" onClick={() => resetWrite()}>
            Try again
          </button>
        </div>
      ) : null}
      <div className="flex justify-between pt-1">
        <button
          type="button"
          className="ar-btn ar-btn-secondary"
          onClick={prevStep}
          disabled={isWritePending || isSyncing}
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        {isConnected && !isLaunchComplete && !txHash ? (
          <button
            type="button"
            className="ar-btn ar-btn-primary"
            onClick={handleRegister}
            disabled={isWritePending || isSyncing || needsChainSwitch}
          >
            {isWritePending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirm in Wallet...
              </>
            ) : (
              <>Create Agent</>
            )}
          </button>
        ) : null}
        {isLaunchComplete && remainingDeployChains === 0 ? (
          <a href={dashboardAgentsUrl()} className="ar-btn ar-btn-primary" target="_blank" rel="noopener noreferrer">
            My agents
          </a>
        ) : null}
      </div>
    </div>
  );
  return (
    <PublicSitePageShell fullBleed className="launch-wizard-page">
      <header className="launch-wizard-header mb-6">
        <AppBackLink fallbackHref="/agents">Back to Agents</AppBackLink>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ar-text-primary)]">Create Agent</h1>
            <p className="mt-1 text-sm text-[var(--ar-text-muted)]">
              Create a new AI agent on the ERC-8004 Identity Registry
            </p>
          </div>
          <a
            href={dashboardAgentsUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="ar-link shrink-0 text-xs font-medium"
          >
            Already have an agent? Manage in Dashboard →
          </a>
        </div>
      </header>
      <LaunchWizardStepper step={step} onStepClick={goToStep} canReach={canReach} />
      {step === 1 ? (
        <LaunchWizardPanel
          title="Basic Information"
          description="Name and describe your agent."
          footer={
            <LaunchWizardNav onNext={nextStep} nextLabel={nextLabel} nextDisabled={nextDisabled} />
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="ar-label">
                Agent Name <span className="text-red-400">*</span>
              </span>
              <input
                id="launch-name"
                className={cn(fieldInputClassName(), "mt-1")}
                placeholder="My AI Agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
              />
            </label>
            <label className="block">
              <span className="ar-label">
                Description <span className="text-red-400">*</span>
              </span>
              <textarea
                id="launch-description"
                className={cn(fieldInputClassName(), "mt-1 min-h-[88px] resize-y")}
                placeholder="Describe what your agent does..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                rows={4}
              />
              <p className="mt-1 text-[10px] text-[var(--ar-text-muted)]">
                {description.length}/2000 characters
              </p>
            </label>
            <div>
              <p className="ar-label">Profile Image (optional)</p>
              <div className="mt-1 flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  <input
                    className={fieldInputClassName()}
                    placeholder="https://example.com/avatar.png"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="ar-btn ar-btn-secondary"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={imageUploading}
                    >
                      {imageUploading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5" />
                      )}
                      {imageUploading ? "Uploading..." : "Upload image"}
                    </button>
                    <span className="text-[10px] text-[var(--ar-text-muted)]">PNG, JPG, WebP up to 5MB</span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleImageUpload(file);
                      }}
                    />
                  </div>
                  {imageUploadError ? <p className="text-xs text-red-400">{imageUploadError}</p> : null}
                </div>
                <AgentAvatar image={imageUrl || null} name={name} size="md" />
              </div>
            </div>
          </div>
        </LaunchWizardPanel>
      ) : null}
      {step === 2 ? (
        <LaunchWizardPanel
          title="Services"
          description="MCP, A2A, OASF, or custom endpoints."
          footer={
            <LaunchWizardNav
              onBack={prevStep}
              onNext={nextStep}
              nextLabel={nextLabel}
              nextDisabled={nextDisabled}
            />
          }
        >
          <div className="mb-3 flex flex-wrap gap-2">
            {LAUNCH_SERVICE_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={cn("ar-chip", serviceDraftKind === kind && "ar-chip-active")}
                onClick={() => setServiceDraftKind(kind)}
              >
                {kind}
              </button>
            ))}
          </div>
          <p className="mb-4 text-xs text-[var(--ar-text-muted)]">{LAUNCH_SERVICE_HINTS[serviceDraftKind]}</p>
          <div className="space-y-4">
            {services.map((service) => (
              <div key={service.id} className="ar-card p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <select
                    className="ar-select"
                    value={service.kind}
                    onChange={(e) =>
                      updateService(service.id, { kind: e.target.value as LaunchServiceKind })
                    }
                  >
                    {LAUNCH_SERVICE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                  <input
                    className={cn(fieldInputClassName(), "flex-1")}
                    placeholder={LAUNCH_SERVICE_PLACEHOLDERS[service.kind]}
                    value={service.endpoint}
                    onChange={(e) => updateService(service.id, { endpoint: e.target.value })}
                  />
                  <button
                    type="button"
                    className="ar-btn ar-btn-secondary px-2"
                    onClick={() => removeService(service.id)}
                    aria-label="Remove service"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {service.kind === "MCP" ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input
                      className={fieldInputClassName()}
                      placeholder="Tools (comma-separated)"
                      value={service.mcpTools}
                      onChange={(e) => updateService(service.id, { mcpTools: e.target.value })}
                    />
                    <input
                      className={fieldInputClassName()}
                      placeholder="Prompts (comma-separated)"
                      value={service.mcpPrompts}
                      onChange={(e) => updateService(service.id, { mcpPrompts: e.target.value })}
                    />
                    <input
                      className={fieldInputClassName()}
                      placeholder="Resources (comma-separated)"
                      value={service.mcpResources}
                      onChange={(e) => updateService(service.id, { mcpResources: e.target.value })}
                    />
                  </div>
                ) : null}
                {service.kind === "A2A" ? (
                  <input
                    className={fieldInputClassName()}
                    placeholder="A2A skills (comma-separated)"
                    value={service.a2aSkills}
                    onChange={(e) => updateService(service.id, { a2aSkills: e.target.value })}
                  />
                ) : null}
              </div>
            ))}
          </div>
          <button type="button" className="ar-btn ar-btn-secondary mt-3 w-full" onClick={addService}>
            <Plus className="h-4 w-4" /> Add {serviceDraftKind} endpoint
          </button>
        </LaunchWizardPanel>
      ) : null}
      {step === 3 ? (
        <LaunchWizardPanel
          title="Capabilities"
          description="OASF skills and domains apply across your agent profile."
          footer={
            <LaunchWizardNav
              onBack={prevStep}
              onNext={nextStep}
              nextLabel={nextLabel}
              nextDisabled={nextDisabled}
            />
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="ar-label">OASF Skills</span>
              <input
                className={cn(fieldInputClassName(), "mt-1")}
                placeholder="research, trading, coding..."
                value={oasfSkills}
                onChange={(e) => setOasfSkills(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="ar-label">OASF Domains</span>
              <input
                className={cn(fieldInputClassName(), "mt-1")}
                placeholder="finance, healthcare, gaming..."
                value={oasfDomains}
                onChange={(e) => setOasfDomains(e.target.value)}
              />
            </label>
          </div>
        </LaunchWizardPanel>
      ) : null}
      {step === 4 ? (
        <LaunchWizardPanel
          title="Advanced"
          description="Trust signals, activity flags, and classification."
          footer={
            <LaunchWizardNav
              onBack={prevStep}
              onNext={nextStep}
              nextLabel={nextLabel}
              nextDisabled={nextDisabled}
            />
          }
        >
          <div className="space-y-4">
            <label className="block">
              <span className="ar-label">Agent Type</span>
              <select
                className={cn("ar-select mt-1 w-full")}
                value={agentType || ""}
                onChange={(e) => setAgentType(e.target.value)}
              >
                <option value="">Not specified</option>
                {LAUNCH_AGENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="ar-label">Tags</span>
              <input
                className={cn(fieldInputClassName(), "mt-1")}
                placeholder="trading, defi, arbitrage..."
                value={agentTags}
                onChange={(e) => setAgentTags(e.target.value)}
              />
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isTEE}
                onChange={(e) => setIsTEE(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[var(--ar-border)]"
              />
              <span className="text-xs text-[var(--ar-text-secondary)]">
                <span className="font-medium text-[var(--ar-text-primary)]">TEE Declaration</span> — TEE self-declaration
              </span>
            </label>
            <label className="block">
              <span className="ar-label">Staked Collateral</span>
              <input
                className={cn(fieldInputClassName(), "mt-1")}
                placeholder="e.g. 1000 USDC"
                value={stakedAmount}
                onChange={(e) => setStakedAmount(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--ar-border)]"
              />
              <span className="text-xs text-[var(--ar-text-secondary)]">Agent is active</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={x402Support}
                onChange={(e) => setX402Support(e.target.checked)}
                className="h-4 w-4 rounded border-[var(--ar-border)]"
              />
              <span className="text-xs text-[var(--ar-text-secondary)]">Enable x402 payment support</span>
            </label>
            <div>
              <span className="ar-label">Supported Trust Models</span>
              <div className="mt-2 space-y-2">
                {LAUNCH_TRUST_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className="flex cursor-pointer items-start gap-3 rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-3"
                  >
                    <input
                      type="checkbox"
                      checked={supportedTrust.includes(opt.id)}
                      onChange={() => toggleTrust(opt.id)}
                      className="mt-0.5 h-4 w-4 rounded border-[var(--ar-border)]"
                    />
                    <span>
                      <span className="block text-xs font-medium text-[var(--ar-text-primary)]">
                        {opt.label}
                      </span>
                      <span className="block text-[10px] text-[var(--ar-text-muted)]">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </LaunchWizardPanel>
      ) : null}
      {step === 5 ? (
        <LaunchWizardPanel
          title="Registration URI"
          description="Choose how your on-chain tokenURI is resolved."
          footer={
            <LaunchWizardNav
              onBack={prevStep}
              onNext={nextStep}
              nextLabel={nextLabel}
              nextDisabled={nextDisabled}
            />
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn("ar-chip", uriMode === "auto" && "ar-chip-active")}
                onClick={() => setUriMode("auto")}
              >
                Auto (data URI)
              </button>
              <button
                type="button"
                className={cn("ar-chip", uriMode === "ipfs" && "ar-chip-active")}
                onClick={() => setUriMode("ipfs")}
              >
                IPFS URL
              </button>
            </div>
            {uriMode === "ipfs" ? (
              <label className="block">
                <span className="ar-label">IPFS URL</span>
                <input
                  className={cn(fieldInputClassName(), "mt-1 font-mono text-xs")}
                  placeholder="ipfs://… or https://gateway…"
                  value={ipfsUrl}
                  onChange={(e) => setIpfsUrl(e.target.value)}
                />
              </label>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--ar-radius)] border border-[var(--ar-border)] p-3">
              <span className="text-xs text-[var(--ar-text-muted)]">Metadata size</span>
              <span className="text-xs font-medium text-[var(--ar-text-primary)]">
                {metadataBytes.toLocaleString()} bytes
              </span>
            </div>
            <button type="button" className="ar-btn ar-btn-secondary" onClick={downloadRegistrationJson}>
              <Download className="h-4 w-4" /> Download JSON
            </button>
            <div>
              <span className="ar-label">Preview</span>
              <pre className="mt-1 max-h-48 overflow-auto rounded-[var(--ar-radius)] border border-[var(--ar-border)] bg-[var(--ar-bg)] p-3 font-mono text-[10px] leading-relaxed text-[var(--ar-text-muted)]">
                {registrationJsonText.slice(0, 600)}
                {registrationJsonText.length > 600 ? "\n…" : ""}
              </pre>
            </div>
          </div>
        </LaunchWizardPanel>
      ) : null}
      {step === 6 ? (
        <LaunchWizardPanel
          title="Networks"
          description="Select chains for wallet deployment."
          footer={
            <LaunchWizardNav
              onBack={prevStep}
              onNext={nextStep}
              nextLabel={nextLabel}
              nextDisabled={nextDisabled}
            />
          }
        >
          {!isStep6Valid ? (
            <p className="mb-3 text-xs text-amber-300">Select at least one deployable network.</p>
          ) : null}
          <div className="space-y-4">
            <div>
              <p className="ar-label mb-2">Mainnets</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {config.mainnetChains.map((chain) => (
                  <ChainSelectCard
                    key={chain.chainId}
                    chain={chain}
                    selected={selectedChainIds.includes(chain.chainId)}
                    onToggle={toggleChain}
                  />
                ))}
              </div>
            </div>
            {config.testnetChains.length > 0 ? (
              <div>
                <p className="ar-label mb-2">Testnets</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {config.testnetChains.map((chain) => (
                    <ChainSelectCard
                      key={chain.chainId}
                      chain={chain}
                      selected={selectedChainIds.includes(chain.chainId)}
                      onToggle={toggleChain}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </LaunchWizardPanel>
      ) : null}
      {step === 7 ? (
        <div className="space-y-4">
          <LaunchWizardPanel title="Review Your Agent">
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <AgentAvatar image={imageUrl || null} name={name} size="lg" />
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-[var(--ar-text-primary)]">{name}</h3>
                  <p className="mt-0.5 text-sm text-[var(--ar-text-muted)]">{description}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {deployableChainIds.map((id) => {
                      const chain = getChainByChainId(id);
                      return chain ? (
                        <ChainBadge
                          key={id}
                          name={chain.shortName}
                          color={chain.color}
                          icon={chain.icon}
                          size="md"
                        />
                      ) : null;
                    })}
                  </div>
                </div>
              </div>
              {services.some((s) => s.endpoint.trim()) ? (
                <div>
                  <p className="ar-label mb-1.5">Services</p>
                  <div className="space-y-1.5">
                    {services
                      .filter((s) => s.endpoint.trim())
                      .map((s) => (
                        <div
                          key={s.id}
                          className="flex items-center gap-2 rounded-[var(--ar-radius)] border border-[var(--ar-border)] px-2 py-1.5"
                        >
                          <ServiceBadge name={s.kind} />
                          <span className="truncate font-mono text-xs text-[var(--ar-text-muted)]">
                            {s.endpoint}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}
              {(oasfSkills.trim() || oasfDomains.trim()) ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {oasfSkills.trim() ? (
                    <div>
                      <p className="ar-label mb-1">OASF Skills</p>
                      <p className="text-xs text-[var(--ar-text-secondary)]">{oasfSkills}</p>
                    </div>
                  ) : null}
                  {oasfDomains.trim() ? (
                    <div>
                      <p className="ar-label mb-1">OASF Domains</p>
                      <p className="text-xs text-[var(--ar-text-secondary)]">{oasfDomains}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-2 text-xs text-[var(--ar-text-muted)] sm:grid-cols-2">
                {agentType ? <p>Type: {agentType}</p> : null}
                {agentTags.trim() ? <p>Tags: {agentTags}</p> : null}
                {isTEE ? <p>TEE declared</p> : null}
                {stakedAmount.trim() ? <p>Staked: {stakedAmount}</p> : null}
                <p>Active: {isActive ? "Yes" : "No"}</p>
                <p>x402: {x402Support ? "Enabled" : "Off"}</p>
                <p>Trust: {supportedTrust.join(", ")}</p>
                <p>
                  URI: {uriMode === "ipfs" && ipfsUrl.trim() ? ipfsUrl.trim() : "Auto data URI"}
                </p>
              </div>
            </div>
          </LaunchWizardPanel>
          <LaunchWizardPanel title={`Deploy to ${selectedChain?.name ?? "Chain"}`}>
            {renderDeploySection()}
          </LaunchWizardPanel>
        </div>
      ) : null}
      <section className="ar-card mt-8 border-dashed p-4">
        <h2 className="text-sm font-semibold text-[var(--ar-text-primary)]">Already registered on-chain?</h2>
        <p className="mt-2 text-xs text-[var(--ar-text-muted)]">
          If your wallet transaction succeeded but this page didn&apos;t finish, paste the transaction hash
          to add the agent to the directory.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              className="ar-select sm:w-44"
              value={String(recoverChainId)}
              onChange={(e) => setRecoverChainId(Number(e.target.value))}
            >
              {config.testnetChains.map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name}
                </option>
              ))}
              {config.mainnetChains.filter(canDeployWithWallet).map((c) => (
                <option key={c.chainId} value={c.chainId}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className={cn(fieldInputClassName(), "flex-1 font-mono text-xs")}
              placeholder="0x… (full 66-character hash)"
              value={recoverTxHash}
              onChange={(e) => setRecoverTxHash(e.target.value.trim())}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="ar-btn ar-btn-secondary shrink-0"
              disabled={!/^0x[a-fA-F0-9]{64}$/.test(recoverTxHash) || !isConnected || isFinalizing}
              onClick={() =>
                void finalizeFromTx(recoverTxHash, { chainId: recoverChainId, recovery: true })
              }
            >
              {isFinalizing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Recovering...
                </>
              ) : (
                "Recover agent"
              )}
            </button>
          </div>
          {isConnected ? null : (
            <p className="text-[10px] text-[var(--ar-text-muted)]">Connect the wallet that registered the agent.</p>
          )}
          {recoverTxHash.length > 0 && !/^0x[a-fA-F0-9]{64}$/.test(recoverTxHash) ? (
            <p className="text-[10px] text-amber-300">
              Paste the full transaction hash from your block explorer (66 characters including 0x).
            </p>
          ) : null}
        </div>
        {insertError && recoverTxHash.trim() ? (
          <p className="mt-2 text-xs text-red-400">{insertError}</p>
        ) : null}
        {resolvedAgentId !== null && dbInserted && recoverTxHash.trim() ? (
          <p className="mt-2 text-xs text-emerald-300">
            Agent #{resolvedAgentId} recovered.{" "}
            <a href={dashboardAgentsUrl()} className="ar-link underline" target="_blank" rel="noopener noreferrer">
              View in Dashboard
            </a>
          </p>
        ) : null}
      </section>
    </PublicSitePageShell>
  );
}