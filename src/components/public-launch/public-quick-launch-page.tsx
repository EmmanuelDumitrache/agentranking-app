"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useSendTransaction, useSwitchChain } from "wagmi";
import {
  Bot,
  Check,
  CheckCircle2,
  Coins,
  ExternalLink,
  ImagePlus,
  Loader2,
  Rocket,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { EthereumIcon } from "@/components/shared/ethereum-icon";
import { RobinhoodChainIcon } from "@/components/shared/robinhood-chain-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/components/ui/toast-simple";
import {
  PublicSitePageHeader,
  PublicSitePanel,
} from "@/components/public-site/public-site-ui";
import { PublicSitePageShell } from "@/components/public-site/public-site-page-shell";
import { useAgentLaunchWallet } from "@/hooks/use-agent-launch-wallet";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { useSourceDraft } from "@/hooks/use-source-draft";
import {
  establishLaunchWalletSession,
  fetchLaunchWalletSession,
  logoutLaunchWalletSession,
} from "@/lib/launch-wallet-session/client";
import type { LaunchWalletSessionState } from "@/lib/launch-wallet-session/types";
import {
  mapTokenLaunchError,
  validateTokenLaunchForm,
  type TokenLaunchFormFields,
} from "@/lib/agent-launch/token-launch-client";
import {
  runPublicSolanaQuickLaunch,
  type LaunchProgressPhase,
} from "@/lib/agent-launch/public-quick-launch-client";
import {
  continuePublicMetaplexLaunch,
  persistPublicMetaplexAttemptId,
  pollPublicMetaplexFunding,
  runPublicMetaplexQuickLaunch,
  type PublicMetaplexFundingInfo,
  type PublicMetaplexOpenAttempt,
  type PublicMetaplexProgressPhase,
} from "@/lib/agent-launch/public-metaplex-quick-launch-client";
import {
  fetchDevnetSolBalance,
  fundAddressFromConnectedWallet,
} from "@/lib/agent-launch/wallet-client";
import type { AgentLaunchFeeDisplayConfig } from "@/lib/agent-launch/config";
import { ROBINHOOD_CHAIN_ID } from "@/lib/robinhood-chain/config";
import { mapWalletError } from "@/lib/robinhood-chain/errors";
import type { PreparedRobinhoodLaunchTx } from "@/lib/robinhood-chain/types";
import { publicTokenDetailHref } from "@/lib/public-site/routes";
import {
  normalizePublicLaunchChain,
  publicMetaplexOpenAttemptKey,
  type PublicLaunchChain,
} from "@/lib/public-launch/initial-state";
import { cn } from "@/lib/utils";
type LaunchChain = PublicLaunchChain;
type LaunchNetwork = "solana" | "evm";
const EMPTY_FORM: TokenLaunchFormFields = {
  tokenName: "",
  tokenSymbol: "",
  tokenDescription: "",
  tokenImageUrl: "",
  website: "",
  twitter: "",
  telegram: "",
};
const EMPTY_SESSION: LaunchWalletSessionState = {
  authenticated: false,
  wallet: null,
  chain: null,
  expiresAt: null,
};
function chainLabel(chain: LaunchChain): string {
  if (chain === "solana") return "Solana · Pump.fun";
  if (chain === "robinhood") return "Robinhood Chain";
  return "Solana · Metaplex Genesis";
}
function networkForChain(chain: LaunchChain): LaunchNetwork {
  return chain === "robinhood" ? "evm" : "solana";
}
function SolanaMark({ className }: { readonly className?: string }) {
  return (
    <Image
      src="/branding/solana/solanaLogoMark.svg"
      alt=""
      width={24}
      height={24}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
function VenueMark({
  venue,
  className,
}: {
  readonly venue: LaunchChain;
  readonly className?: string;
}) {
  if (venue === "robinhood") {
    return <RobinhoodChainIcon className={className} />;
  }
  if (venue === "solana") {
    return (
      <Image
        src="/brandkit/protocol-logos/pumpfun.png"
        alt=""
        width={32}
        height={32}
        className={cn("shrink-0 rounded-md object-cover", className)}
      />
    );
  }
  return (
    <Image
      src="/branding/metaplex/metaplex-icon.png"
      alt=""
      width={36}
      height={36}
      className={cn("shrink-0 rounded-md object-contain", className)}
    />
  );
}
function LaunchOutcomeIcon({
  kind,
}: {
  readonly kind: "token" | "agent" | "both";
}) {
  if (kind === "both") {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="inline-flex size-7 items-center justify-center rounded-md border border-border/60 bg-muted/30">
          <Bot className="size-3.5" aria-hidden />
        </span>
        <span className="inline-flex size-7 items-center justify-center rounded-md border border-border/60 bg-muted/30">
          <Coins className="size-3.5" aria-hidden />
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex size-7 items-center justify-center rounded-md border border-border/60 bg-muted/30">
      {kind === "agent" ? (
        <Bot className="size-3.5" aria-hidden />
      ) : (
        <Coins className="size-3.5" aria-hidden />
      )}
    </span>
  );
}
function LaunchReviewSummary({
  chain,
  tokenSymbol,
}: {
  readonly chain: LaunchChain;
  readonly tokenSymbol: string;
}) {
  const symbolLabel = tokenSymbol.trim() ? `$${tokenSymbol.trim().toUpperCase()}` : "your token";
  if (chain === "metaplex") {
    return (
      <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-muted/15 p-3">
        <div className="flex items-start gap-3">
          <LaunchOutcomeIcon kind="both" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">Agent + token launch</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Metaplex Genesis creates <strong className="text-foreground">{symbolLabel}</strong> and a
              new AgentRanking agent permanently bound to it.
            </p>
          </div>
        </div>
        <ul className="text-muted-foreground space-y-1.5 pl-10 text-xs leading-relaxed">
          <li>Manage identity, services, and verification in the creator app after launch.</li>
          <li>Claim creator rewards and fees from your agent dashboard.</li>
          <li>
            <Link href="/dashboard" className="text-foreground underline-offset-2 hover:underline">
              Open AgentRanking app
            </Link>
          </li>
        </ul>
      </div>
    );
  }
  if (chain === "solana") {
    return (
      <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-muted/15 p-3">
        <div className="flex items-start gap-3">
          <LaunchOutcomeIcon kind="token" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">Token only</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Launches <strong className="text-foreground">{symbolLabel}</strong> on Pump.fun. No
              AgentRanking agent profile is created.
            </p>
          </div>
        </div>
        <p className="text-muted-foreground pl-10 text-xs leading-relaxed">
          Creator fees are claimed through Pump.fun once the token starts trading.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-border/60 bg-muted/15 p-3">
      <div className="flex items-start gap-3">
        <LaunchOutcomeIcon kind="token" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">Token on Robinhood Chain</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Launches <strong className="text-foreground">{symbolLabel}</strong> via Quiver on Robinhood
            Chain. No Solana agent is created.
          </p>
        </div>
      </div>
    </div>
  );
}
async function cropFileToSquare(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("Image cropping is not supported in this browser");
  }
  context.drawImage(bitmap, sx, sy, side, side, 0, 0, 512, 512);
  bitmap.close();
  const outputType = file.type === "image/png" ? "image/png" : "image/webp";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, outputType, 0.9),
  );
  if (!blob) throw new Error("Could not crop image");
  const extension = outputType === "image/png" ? "png" : "webp";
  return new File([blob], file.name.replace(/\.[^.]+$/, `.${extension}`), {
    type: outputType,
  });
}
function phaseLabel(phase: LaunchProgressPhase | PublicMetaplexProgressPhase): string {
  switch (phase) {
    case "draft":
      return "Starting draft…";
    case "details":
      return "Saving token details…";
    case "metadata":
      return "Publishing metadata…";
    case "preparing":
      return "Preparing transaction…";
    case "signing":
      return "Confirm in wallet…";
    case "sending":
      return "Sending transaction…";
    case "confirming":
      return "Confirming on-chain…";
    case "create":
      return "Creating token…";
    case "routing":
      return "Activating fee routing…";
    case "syncing":
      return "Syncing launch…";
    case "funding":
      return "Waiting for agent wallet funding…";
    case "upload":
      return "Uploading artwork to Irys…";
    case "mint_agent":
      return "Minting Metaplex agent…";
    case "genesis":
      return "Launching Genesis bonding curve…";
    case "index":
      return "Indexing on AgentRanking…";
    case "done":
      return "Launch complete";
    default:
      return "Working…";
  }
}
function mapMetaplexPhaseToLaunchPhase(
  phase: PublicMetaplexProgressPhase,
): LaunchProgressPhase {
  switch (phase) {
    case "draft":
      return "draft";
    case "funding":
      return "preparing";
    case "upload":
      return "metadata";
    case "mint_agent":
      return "create";
    case "genesis":
      return "signing";
    case "index":
      return "syncing";
    case "done":
      return "done";
    case "idle":
      return "idle";
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
function progressIndexForPhase(
  phase: LaunchProgressPhase,
  chain: LaunchChain,
): number {
  if (chain === "robinhood") {
    if (phase === "signing") return 1;
    if (phase === "confirming" || phase === "syncing" || phase === "done") return 2;
    return 0;
  }
  if (chain === "metaplex") {
    if (phase === "draft") return 0;
    if (phase === "preparing") return 1;
    if (phase === "metadata") return 2;
    if (phase === "create") return 3;
    if (phase === "signing" || phase === "syncing" || phase === "done") return 4;
    return 0;
  }
  if (phase === "metadata") return 1;
  if (
    phase === "preparing" ||
    phase === "create" ||
    phase === "signing" ||
    phase === "sending"
  ) {
    return 2;
  }
  if (phase === "confirming") return 3;
  if (phase === "routing" || phase === "syncing" || phase === "done") return 4;
  return 0;
}
function LaunchRedirectCountdown({ onComplete }: { readonly onComplete: () => void }) {
  const [seconds, setSeconds] = useState(5);
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setSeconds((current) => Math.max(0, current - 1));
    }, 1_000);
    const redirectId = window.setTimeout(onComplete, 5_000);
    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(redirectId);
    };
  }, [onComplete]);
  return <>Opening My launches &amp; fees in {seconds} seconds…</>;
}
export function PublicQuickLaunchPage({
  launchAgentHref,
  initialChain,
  initialAttemptId,
  initialWalletSession,
  initialOpenMetaplexAttempt,
  initialRobinhoodLaunchFeeEth,
  feeDisplay,
}: {
  readonly launchAgentHref: string;
  readonly initialChain: LaunchChain;
  readonly initialAttemptId: string | null;
  readonly initialWalletSession: LaunchWalletSessionState;
  readonly initialOpenMetaplexAttempt: PublicMetaplexOpenAttempt | null;
  readonly initialRobinhoodLaunchFeeEth: string | null;
  readonly feeDisplay: AgentLaunchFeeDisplayConfig;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const attemptParam = searchParams.get("attempt") ?? initialAttemptId;
  const [selectedChain, setSelectedChain] = useState<LaunchChain>(() =>
    normalizePublicLaunchChain(searchParams.get("chain") ?? initialChain),
  );
  const loadSession = useCallback((_signal: AbortSignal) => fetchLaunchWalletSession(), []);
  const sessionResource = useAsyncResource("public-launch-wallet-session", loadSession, {
    initialData: initialWalletSession,
    initialDataKey: "public-launch-wallet-session",
    revalidateOnMount: false,
  });
  const sessionSource = sessionResource.data ?? EMPTY_SESSION;
  const [walletSession, setWalletSession] = useSourceDraft(
    `${sessionSource.wallet ?? "anonymous"}:${sessionSource.chain ?? "none"}:${sessionSource.expiresAt ?? "none"}`,
    sessionSource,
  );
  const sessionLoading = sessionResource.loading;
  const [signingSession, setSigningSession] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchPhase, setLaunchPhase] = useState<LaunchProgressPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [completedMint, setCompletedMint] = useState<string | null>(null);
  const [completedRobinhoodAddress, setCompletedRobinhoodAddress] = useState<string | null>(null);
  const [draggingImage, setDraggingImage] = useState(false);
  const [metaplexFunding, setMetaplexFunding] = useState<PublicMetaplexFundingInfo | null>(null);
  const [continuingMetaplex, setContinuingMetaplex] = useState(false);
  const [checkingFunding, setCheckingFunding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageFileRef = useRef<File | null>(null);
  const fundingResumeRef = useRef<(() => void) | null>(null);
  const solWallet = useAgentLaunchWallet();
  const { address, chain, isConnected } = useAccount();
  const { switchChain, isPending: switchingChain } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();
  const onRobinhoodChain = chain?.id === ROBINHOOD_CHAIN_ID;
  const selectedNetwork = networkForChain(selectedChain);
  const launchComplete = Boolean(completedMint || completedRobinhoodAddress);
  const activeWallet =
    selectedChain === "robinhood"
      ? address?.toLowerCase() ?? null
      : solWallet.address;
  const loadOpenMetaplexAttempt = useCallback(async (signal: AbortSignal) => {
    if (selectedChain !== "metaplex" || !walletSession.authenticated) return null;
    const query = attemptParam ? `?attempt=${encodeURIComponent(attemptParam)}` : "";
    const response = await fetch(`/api/public-launch/metaplex/open${query}`, {
      cache: "no-store",
      signal,
    });
    const body = (await response.json()) as {
      attempt?: PublicMetaplexOpenAttempt | null;
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Could not load open launch");
    const open = body.attempt ?? null;
    if (open) persistPublicMetaplexAttemptId(open.attempt.id);
    return open;
  }, [attemptParam, selectedChain, walletSession.authenticated]);
  const openAttemptKey = publicMetaplexOpenAttemptKey({
    chain: selectedChain,
    authenticated: walletSession.authenticated,
    attemptId: attemptParam,
  });
  const initialOpenAttemptKey = publicMetaplexOpenAttemptKey({
    chain: initialChain,
    authenticated: initialWalletSession.authenticated,
    attemptId: initialAttemptId,
  });
  const openAttemptResource = useAsyncResource(openAttemptKey, loadOpenMetaplexAttempt, {
    initialData: initialOpenMetaplexAttempt,
    initialDataKey: initialOpenAttemptKey,
    revalidateOnMount: false,
  });
  const openMetaplexAttempt = openAttemptResource.data;
  const setOpenMetaplexAttempt = openAttemptResource.setData;
  const loadingOpenAttempt = selectedChain === "metaplex" && openAttemptResource.loading;
  const formSource = useMemo<TokenLaunchFormFields>(() => ({
    ...EMPTY_FORM,
    tokenName: openMetaplexAttempt?.tokenName ?? "",
    tokenSymbol: openMetaplexAttempt?.tokenSymbol ?? "",
    tokenImageUrl: openMetaplexAttempt?.tokenImageUrl ?? "",
  }), [openMetaplexAttempt]);
  const attemptSourceKey = openMetaplexAttempt?.attempt.id ?? "manual-launch";
  const [form, setForm] = useSourceDraft(attemptSourceKey, formSource);
  const [metaplexBindChecked, setMetaplexBindChecked] = useSourceDraft(
    attemptSourceKey,
    Boolean(openMetaplexAttempt),
  );
  const [hasImageFile, setHasImageFile] = useSourceDraft(
    attemptSourceKey,
    Boolean(openMetaplexAttempt?.tokenImageUrl),
  );
  const loadSolBalance = useCallback(async (signal: AbortSignal): Promise<string | null> => {
    if ((selectedChain !== "solana" && selectedChain !== "metaplex") || !solWallet.address) return null;
    const lamports = await fetchDevnetSolBalance(solWallet.address);
    if (signal.aborted) throw signal.reason;
    return (Number(lamports) / 1_000_000_000).toFixed(4);
  }, [selectedChain, solWallet.address]);
  const solBalanceResource = useAsyncResource(
    `public-launch-sol-balance:${selectedChain}:${solWallet.address ?? "none"}`,
    loadSolBalance,
  );
  const solBalance = solBalanceResource.data;
  const loadRobinhoodFee = useCallback(async (signal: AbortSignal): Promise<string | null> => {
    if (selectedChain !== "robinhood") return null;
    const response = await fetch("/api/robinhood/prepare-launch", { signal });
    if (!response.ok) return null;
    const data = (await response.json()) as { launchFeeEth?: string };
    return data.launchFeeEth ?? null;
  }, [selectedChain]);
  const robinhoodFeeResource = useAsyncResource(
    `public-launch-robinhood-fee:${selectedChain}`,
    loadRobinhoodFee,
    {
      initialData: initialRobinhoodLaunchFeeEth,
      initialDataKey: `public-launch-robinhood-fee:${initialChain}`,
      revalidateOnMount: false,
    },
  );
  const launchFeeEth = robinhoodFeeResource.data;
  const update = useCallback(<K extends keyof TokenLaunchFormFields>(key: K, value: TokenLaunchFormFields[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }, [setForm]);
  const refreshSession = sessionResource.refresh;
  const completeRedirect = useCallback(() => router.push("/launch/fees"), [router]);
  const ensureWalletSession = useCallback(async () => {
    const chainType = selectedChain === "robinhood" ? "evm" : "solana";
    if (!activeWallet) throw new Error("Connect your wallet first.");
    if (
      walletSession.authenticated &&
      walletSession.wallet === activeWallet &&
      walletSession.chain === chainType
    ) {
      return walletSession;
    }
    setSigningSession(true);
    try {
      const session = await establishLaunchWalletSession({
        chain: chainType,
        wallet: activeWallet,
      });
      setWalletSession(session);
      return session;
    } finally {
      setSigningSession(false);
    }
  }, [activeWallet, selectedChain, setWalletSession, walletSession]);
  const uploadImage = useCallback(async (file: File) => {
    setUploading(true);
    try {
      await ensureWalletSession();
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/public-launch/uploads/token-image", { method: "POST", body: fd });
      const data = (await res.json()) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Upload failed");
      imageFileRef.current = file;
      setHasImageFile(true);
      update("tokenImageUrl", data.url);
      showToast("Logo uploaded");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Upload failed", "error");
    } finally {
      setUploading(false);
    }
  }, [ensureWalletSession, setHasImageFile, update]);
  const handleImageFile = useCallback(
    async (file: File) => {
      const allowed = ["image/png", "image/jpeg", "image/webp"];
      if (!allowed.includes(file.type)) {
        showToast("Image must be PNG, JPG, or WebP", "error");
        return;
      }
      if (file.size === 0) {
        showToast("Image file is empty", "error");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        showToast("Image must be 5 MB or smaller", "error");
        return;
      }
      try {
        const cropped = await cropFileToSquare(file);
        await uploadImage(cropped);
      } catch (uploadError) {
        showToast(
          uploadError instanceof Error ? uploadError.message : "Could not prepare image",
          "error",
        );
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [uploadImage],
  );
  const selectNetwork = useCallback((network: LaunchNetwork) => {
    setSelectedChain(network === "solana" ? "solana" : "robinhood");
    setError(null);
  }, []);
  const launchSolana = useCallback(async () => {
    if (!solWallet.address) throw new Error("Connect Phantom first.");
    const validation = validateTokenLaunchForm(form);
    if (validation) throw new Error(validation);
    if (!form.tokenImageUrl.trim()) throw new Error("Upload a token logo first.");
    await ensureWalletSession();
    setLaunching(true);
    setLaunchPhase("draft");
    try {
      const launch = await runPublicSolanaQuickLaunch({
        creatorWallet: solWallet.address,
        fields: form,
        onPhase: setLaunchPhase,
      });
      if (launch.mint) {
        setCompletedMint(launch.mint);
        showToast("Token launched on Solana", "success");
      }
    } finally {
      setLaunching(false);
      setLaunchPhase("idle");
    }
  }, [ensureWalletSession, form, solWallet.address]);
  const fundMetaplexFromPhantom = useCallback(
    async (info: PublicMetaplexFundingInfo) => {
      const shortfall = info.shortfallLamports > 0
        ? info.shortfallLamports
        : Math.max(0, info.minLamports - info.balanceLamports);
      if (shortfall <= 0) return;
      showToast("Approve the transfer in Phantom…", "info");
      const sent = await fundAddressFromConnectedWallet({
        toAddress: info.custodialWallet,
        lamports: shortfall,
      });
      for (let i = 0; i < 30; i++) {
        const funding = await pollPublicMetaplexFunding(info.attemptId);
        setMetaplexFunding(funding);
        setOpenMetaplexAttempt((prev) =>
          prev
            ? {
                ...prev,
                balanceLamports: funding.balanceLamports,
                minLamports: funding.minLamports,
                shortfallLamports: funding.shortfallLamports,
                funded: funding.funded,
                stage: funding.stage,
                fundingMessage: funding.fundingMessage,
              }
            : prev,
        );
        if (funding.funded || funding.balanceLamports >= Math.floor(info.minLamports * 0.9)) {
          return;
        }
        if (i > 2 && funding.balanceLamports >= sent.lamportsSent) {
          if (funding.balanceLamports + 5_000_000 >= info.minLamports) return;
        }
        await new Promise((r) => setTimeout(r, 1_200));
      }
      throw new Error("Transfer sent, but launch wallet balance is still catching up. Try again in a few seconds.");
    },
    [setOpenMetaplexAttempt],
  );
  const resumeMetaplexFunding = useCallback(async () => {
    if (!metaplexFunding) return;
    setCheckingFunding(true);
    setError(null);
    try {
      await fundMetaplexFromPhantom(metaplexFunding);
      fundingResumeRef.current?.();
      fundingResumeRef.current = null;
      showToast("Funded from Phantom — continuing launch", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not fund from Phantom";
      setError(message);
      showToast(message, "error");
    } finally {
      setCheckingFunding(false);
    }
  }, [fundMetaplexFromPhantom, metaplexFunding]);
  const launchMetaplex = useCallback(async () => {
    if (!solWallet.address) throw new Error("Connect Phantom first.");
    if (!metaplexBindChecked) {
      throw new Error("Confirm permanent Metaplex token binding before launching.");
    }
    const validation = validateTokenLaunchForm(form);
    if (validation) throw new Error(validation);
    if (!form.tokenImageUrl.trim() || !imageFileRef.current) {
      throw new Error("Upload a token logo first.");
    }
    await ensureWalletSession();
    setLaunching(true);
    setLaunchPhase("draft");
    setMetaplexFunding(null);
    try {
      let pendingFunding: PublicMetaplexFundingInfo | null = null;
      const attempt = await runPublicMetaplexQuickLaunch({
        fields: form,
        imageFile: imageFileRef.current,
        permanentBindConfirmed: metaplexBindChecked,
        onPhase: (phase) => setLaunchPhase(mapMetaplexPhaseToLaunchPhase(phase)),
        onNeedsFunding: (info) => {
          pendingFunding = info;
          setMetaplexFunding(info);
        },
        waitForFunding: async () => {
          if (!pendingFunding) {
            throw new Error("Missing launch funding details.");
          }
          setCheckingFunding(true);
          try {
            await fundMetaplexFromPhantom(pendingFunding);
            return;
          } catch (autoFundError) {
            const message =
              autoFundError instanceof Error
                ? autoFundError.message
                : "Phantom transfer was cancelled.";
            setError(message);
            showToast(message, "error");
          } finally {
            setCheckingFunding(false);
          }
          // User can retry via "Approve transfer in Phantom"
          await new Promise<void>((resolve) => {
            fundingResumeRef.current = resolve;
          });
        },
      });
      if (attempt.tokenMint) {
        setCompletedMint(attempt.tokenMint);
        showToast("Token launched on Metaplex Genesis", "success");
      } else if (attempt.status === "COMPLETE" || attempt.status === "AR_INDEX_PENDING") {
        setCompletedMint(attempt.assetAddress || attempt.id);
        showToast("Metaplex Genesis launch submitted", "success");
      } else {
        throw new Error(attempt.errorMessage || "Metaplex launch did not complete.");
      }
      setMetaplexFunding(null);
    } finally {
      setLaunching(false);
      setLaunchPhase("idle");
    }
  }, [
    ensureWalletSession,
    form,
    fundMetaplexFromPhantom,
    metaplexBindChecked,
    solWallet.address,
  ]);
  const continueOpenMetaplexLaunch = useCallback(async () => {
    if (!openMetaplexAttempt) return;
    if (!solWallet.address) throw new Error("Connect Phantom first.");
    await ensureWalletSession();
    setContinuingMetaplex(true);
    setError(null);
    try {
      let funding = await pollPublicMetaplexFunding(openMetaplexAttempt.attempt.id);
      if (!funding.funded) {
        setMetaplexFunding(funding);
        await fundMetaplexFromPhantom(funding);
        funding = await pollPublicMetaplexFunding(openMetaplexAttempt.attempt.id);
      }
      if (!funding.funded) {
        throw new Error(funding.fundingMessage);
      }
      setLaunching(true);
      setLaunchPhase("create");
      const attempt = await continuePublicMetaplexLaunch(openMetaplexAttempt.attempt.id);
      if (attempt.tokenMint) {
        setCompletedMint(attempt.tokenMint);
        setOpenMetaplexAttempt(null);
        setMetaplexFunding(null);
        showToast("Token launched on Metaplex Genesis", "success");
      } else if (attempt.status === "COMPLETE" || attempt.status === "AR_INDEX_PENDING") {
        setCompletedMint(attempt.assetAddress || attempt.id);
        setOpenMetaplexAttempt(null);
        setMetaplexFunding(null);
        showToast("Metaplex Genesis launch submitted", "success");
      } else {
        throw new Error(attempt.errorMessage || "Metaplex launch did not complete.");
      }
    } catch (err) {
      const message = mapTokenLaunchError(err);
      setError(message);
      showToast(message, "error");
    } finally {
      setContinuingMetaplex(false);
      setLaunching(false);
      setLaunchPhase("idle");
    }
  }, [ensureWalletSession, fundMetaplexFromPhantom, openMetaplexAttempt, setOpenMetaplexAttempt, solWallet.address]);
  const launchRobinhood = useCallback(async () => {
    if (!address) throw new Error("Connect your wallet first.");
    if (!onRobinhoodChain) throw new Error("Switch to Robinhood Chain (4663).");
    const validation = validateTokenLaunchForm(form);
    if (validation) throw new Error(validation);
    if (!form.tokenImageUrl.trim()) throw new Error("Upload a token logo first.");
    await ensureWalletSession();
    setLaunching(true);
    setLaunchPhase("preparing");
    try {
      const prepareRes = await fetch("/api/robinhood/prepare-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          creatorWallet: address,
          agentDbId: null,
        }),
      });
      const prepareData = (await prepareRes.json()) as {
        prepared?: PreparedRobinhoodLaunchTx;
        error?: string;
      };
      if (!prepareRes.ok || !prepareData.prepared) {
        throw new Error(prepareData.error || "Could not prepare launch");
      }
      const { prepared } = prepareData;
      if (prepared.signerWallet.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Wallet mismatch — reconnect and try again.");
      }
      setLaunchPhase("signing");
      const hash = await sendTransactionAsync({
        chainId: ROBINHOOD_CHAIN_ID,
        account: address,
        to: prepared.to as `0x${string}`,
        data: prepared.data as `0x${string}`,
        value: BigInt(prepared.value),
        gas: prepared.gasSuggestion ? BigInt(prepared.gasSuggestion) : undefined,
      });
      setLaunchPhase("confirming");
      const recordRes = await fetch("/api/robinhood/record-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          txHash: hash,
          preparationId: prepared.preparationId,
        }),
      });
      const recordData = (await recordRes.json()) as {
        launch?: { tokenAddress: string };
        error?: string;
      };
      if (!recordRes.ok || !recordData.launch) {
        throw new Error(recordData.error || "Launch confirmed but indexing failed.");
      }
      setCompletedRobinhoodAddress(recordData.launch.tokenAddress);
      showToast("Token launched on Robinhood Chain", "success");
      setLaunchPhase("done");
    } catch (err) {
      const mapped = mapWalletError(err);
      throw new Error(mapped.message);
    } finally {
      setLaunching(false);
    }
  }, [address, ensureWalletSession, form, onRobinhoodChain, sendTransactionAsync]);
  const onLaunch = useCallback(async () => {
    setError(null);
    try {
      if (selectedChain === "metaplex") {
        await launchMetaplex();
      } else if (selectedChain === "solana") {
        await launchSolana();
      } else {
        await launchRobinhood();
      }
    } catch (err) {
      const message = mapTokenLaunchError(err);
      setError(message);
      showToast(message, "error");
    }
  }, [launchMetaplex, launchRobinhood, launchSolana, selectedChain]);
  const canLaunch = useMemo(() => {
    if (!form.tokenName.trim() || !form.tokenSymbol.trim() || !form.tokenImageUrl.trim()) return false;
    if (launching || uploading || signingSession || checkingFunding) return false;
    if (selectedChain === "solana") return solWallet.connected;
    if (selectedChain === "metaplex") {
      return solWallet.connected && metaplexBindChecked && hasImageFile;
    }
    return isConnected && onRobinhoodChain;
  }, [
    checkingFunding,
    form,
    hasImageFile,
    isConnected,
    launching,
    metaplexBindChecked,
    onRobinhoodChain,
    selectedChain,
    signingSession,
    solWallet.connected,
    uploading,
  ]);
  const artworkLabel = uploading
    ? "Cropping and uploading…"
    : form.tokenImageUrl
      ? "Replace token artwork"
      : "Drop artwork here or choose a file";
  if (launching) {
    const progressSteps: LaunchProgressPhase[] =
      selectedChain === "solana"
        ? ["draft", "metadata", "signing", "confirming", "routing"]
        : selectedChain === "metaplex"
          ? ["draft", "preparing", "metadata", "create", "signing"]
          : ["preparing", "signing", "confirming"];
    const activeIndex = progressIndexForPhase(launchPhase, selectedChain);
    const waitingOnFunding = selectedChain === "metaplex" && Boolean(metaplexFunding);
    return (
      <PublicSitePageShell>
        <PublicSitePageHeader
          eyebrow="Launch in progress"
          title={`Launching ${form.tokenName || form.tokenSymbol}`}
          description={
            waitingOnFunding
              ? "Approve one SOL transfer in Phantom, then we continue the launch automatically."
              : "Keep this page open and approve requests in your wallet. Never submit the launch twice."
          }
        />
        <PublicSitePanel className="mx-auto w-full max-w-3xl overflow-hidden p-0">
          <div className="border-b border-[var(--console-border)] px-6 py-8 text-center sm:px-10 sm:py-12">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--console-border)] bg-[var(--console-panel-raised)]">
              {waitingOnFunding ? (
                checkingFunding ? (
                  <Loader2 className="h-7 w-7 animate-spin text-[var(--console-accent)]" />
                ) : (
                  <ShieldCheck className="h-7 w-7 text-[var(--console-accent)]" />
                )
              ) : (
                <Loader2 className="h-7 w-7 animate-spin text-[var(--console-accent)]" />
              )}
            </div>
            <p className="mt-5 text-lg font-semibold">
              {waitingOnFunding ? "Approve in Phantom" : phaseLabel(launchPhase)}
            </p>
            <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm">
              {waitingOnFunding
                ? "Same as Pump — use your connected Phantom. Approve the fee transfer, then we finish Genesis automatically."
                : `${chainLabel(selectedChain)} is processing your launch. Approve any prompts in your connected wallet.`}
            </p>
            {waitingOnFunding && metaplexFunding ? (
              <div className="mx-auto mt-6 max-w-lg rounded-xl border border-[var(--console-border)] bg-black/20 p-4 text-left">
                <p className="text-muted-foreground text-xs">
                  About{" "}
                  {(
                    (metaplexFunding.shortfallLamports > 0
                      ? metaplexFunding.shortfallLamports
                      : Math.max(0, metaplexFunding.minLamports - metaplexFunding.balanceLamports)) /
                    1e9
                  ).toFixed(3)}{" "}
                  SOL from your connected Phantom
                </p>
                <Button
                  type="button"
                  className="mt-4 w-full"
                  disabled={checkingFunding}
                  onClick={() => void resumeMetaplexFunding()}
                >
                  {checkingFunding ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Waiting for Phantom…
                    </>
                  ) : (
                    "Open Phantom approval"
                  )}
                </Button>
                {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 p-5 sm:grid-cols-3 sm:p-6">
            {progressSteps.map((step, index) => {
              const complete = index < activeIndex;
              const active = index === activeIndex;
              return (
                <div
                  key={step}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs",
                    active
                      ? "border-[var(--app-accent)] bg-[var(--app-panel-raised)] text-foreground"
                      : "border-[var(--app-border)] text-muted-foreground",
                  )}
                >
                  {complete ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border border-current" />
                  )}
                  {phaseLabel(step).replace("…", "")}
                </div>
              );
            })}
          </div>
        </PublicSitePanel>
      </PublicSitePageShell>
    );
  }
  if (launchComplete) {
    const tokenHref = completedMint
      ? publicTokenDetailHref(completedMint)
      : `/tokens/robinhood/${completedRobinhoodAddress}`;
    return (
      <PublicSitePageShell>
        <PublicSitePanel className="mx-auto w-full max-w-3xl overflow-hidden p-0">
          <div className="border-b border-emerald-500/20 bg-emerald-500/[0.04] px-6 py-10 text-center sm:px-10 sm:py-14">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="mt-5 text-xs font-medium uppercase tracking-[0.18em] text-emerald-400">
              Launch complete
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              {form.tokenName} is live
            </h1>
            <p className="text-muted-foreground mx-auto mt-3 max-w-lg text-sm leading-6">
              Your token was created on {chainLabel(selectedChain)} and added to your wallet-owned launches.
            </p>
          </div>
          <div className="space-y-4 p-5 sm:p-6">
            <div className="ui-public-site-card flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                {form.tokenImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.tokenImageUrl}
                    alt=""
                    className="h-12 w-12 rounded-xl object-cover"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{form.tokenName}</p>
                  <p className="text-muted-foreground text-xs">
                    ${form.tokenSymbol} · {chainLabel(selectedChain)}
                  </p>
                </div>
              </div>
              <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1" onClick={() => router.push("/launch/fees")}>
                View my launches
                <Rocket className="ml-2 h-4 w-4" />
              </Button>
              <Link
                href={tokenHref}
                className="ui-btn ui-btn-secondary flex-1 justify-center"
              >
                View token
                <ExternalLink className="ml-2 h-4 w-4" />
              </Link>
            </div>
            <p className="text-muted-foreground text-center text-xs">
              <LaunchRedirectCountdown onComplete={completeRedirect} />
            </p>
          </div>
        </PublicSitePanel>
      </PublicSitePageShell>
    );
  }
  return (
    <PublicSitePageShell>
      <PublicSitePageHeader
        eyebrow="Quick launchpad"
        title="Launch a token"
        description="Wallet-only quick launch — connect once, then Pump, Metaplex, or Robinhood all use that connected wallet."
        actions={
          <Link href="/launch/fees" className="ui-btn ui-btn-secondary ui-btn-sm whitespace-nowrap">
            My launches / fees
          </Link>
        }
      />
      <PublicSitePanel className="border-dashed bg-[var(--app-panel)]/60 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Bot className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ar-text-secondary)]" />
            <div>
              <p className="text-sm font-medium">Launching a tokenized agent?</p>
              <p className="text-muted-foreground text-sm">
                Attach identity, passport, and dashboard tools in the creator app.
              </p>
            </div>
          </div>
          <Link href={launchAgentHref} className="ui-btn ui-btn-primary ui-btn-sm shrink-0">
            Launch agent
          </Link>
        </div>
      </PublicSitePanel>
      {selectedChain === "metaplex" && openMetaplexAttempt ? (
        <PublicSitePanel className="border-amber-500/30 bg-amber-500/[0.04] p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-300">
                Continue launch
              </p>
              <p className="mt-1 text-sm font-semibold">
                {openMetaplexAttempt.tokenName || "Metaplex token"}{" "}
                {openMetaplexAttempt.tokenSymbol
                  ? `(${openMetaplexAttempt.tokenSymbol})`
                  : ""}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Status: {openMetaplexAttempt.attempt.status.replaceAll("_", " ").toLowerCase()}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                {openMetaplexAttempt.fundingMessage}
              </p>
              <p className="text-muted-foreground mt-2 font-mono text-[11px] break-all">
                Deposit: {openMetaplexAttempt.custodialWallet}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Balance {(openMetaplexAttempt.balanceLamports / 1e9).toFixed(4)} SOL · need{" "}
                {(openMetaplexAttempt.minLamports / 1e9).toFixed(3)} SOL
              </p>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-52">
              <Button
                type="button"
                disabled={continuingMetaplex || checkingFunding || loadingOpenAttempt}
                onClick={() => {
                  const info: PublicMetaplexFundingInfo = {
                    attemptId: openMetaplexAttempt.attempt.id,
                    custodialWallet: openMetaplexAttempt.custodialWallet,
                    balanceLamports: openMetaplexAttempt.balanceLamports,
                    minLamports: openMetaplexAttempt.minLamports,
                    shortfallLamports: openMetaplexAttempt.shortfallLamports,
                    funded: openMetaplexAttempt.funded,
                    stage: openMetaplexAttempt.stage,
                    fundingMessage: openMetaplexAttempt.fundingMessage,
                  };
                  setCheckingFunding(true);
                  void fundMetaplexFromPhantom(info)
                    .then(async () => {
                      const funding = await pollPublicMetaplexFunding(info.attemptId);
                      setOpenMetaplexAttempt((prev) =>
                        prev ? { ...prev, ...funding } : prev,
                      );
                      showToast("Funded from Phantom", "success");
                    })
                    .catch((err) => {
                      showToast(err instanceof Error ? err.message : "Funding failed", "error");
                    })
                    .finally(() => setCheckingFunding(false));
                }}
              >
                {checkingFunding ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Waiting for Phantom…
                  </>
                ) : (
                  "Fund from Phantom"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={continuingMetaplex || checkingFunding}
                onClick={() => void continueOpenMetaplexLaunch()}
              >
                {continuingMetaplex ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Minting…
                  </>
                ) : (
                  "Retry mint"
                )}
              </Button>
            </div>
          </div>
          {error ? <p className="mt-3 text-xs text-red-400">{error}</p> : null}
        </PublicSitePanel>
      ) : null}
      <div className="space-y-4">
        <PublicSitePanel className="p-0">
          <div className="border-b border-[var(--app-border)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
                1
              </span>
              <div>
                <p className="text-sm font-semibold">Choose network and launch venue</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Pick the ecosystem first, then the protocol that creates your token.
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
            <button
              type="button"
              onClick={() => selectNetwork("solana")}
              className={cn(
                "ui-public-site-card flex min-h-24 items-center gap-4 p-4 text-left transition-all",
                selectedNetwork === "solana" &&
                  "border-[var(--app-accent)] bg-[var(--app-panel-raised)] ring-1 ring-[var(--app-accent)]",
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--app-border)] bg-black/30">
                <SolanaMark className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Solana</span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  Fast token launches with native SOL
                </span>
              </span>
              {selectedNetwork === "solana" ? (
                <Check className="ml-auto h-4 w-4 text-emerald-400" />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => selectNetwork("evm")}
              className={cn(
                "ui-public-site-card flex min-h-24 items-center gap-4 p-4 text-left transition-all",
                selectedNetwork === "evm" &&
                  "border-[var(--app-accent)] bg-[var(--app-panel-raised)] ring-1 ring-[var(--app-accent)]",
              )}
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--app-border)] bg-black/30">
                <EthereumIcon className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">EVM</span>
                <span className="text-muted-foreground mt-1 block text-xs">
                  Ethereum-compatible launch networks
                </span>
              </span>
              {selectedNetwork === "evm" ? (
                <Check className="ml-auto h-4 w-4 text-emerald-400" />
              ) : null}
            </button>
          </div>
          <div className="border-t border-[var(--app-border)] p-4 sm:p-5">
            <p className="text-xs font-medium uppercase tracking-wide">
              Launch venue
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {selectedNetwork === "solana" ? (
                <>
                  <button
                    type="button"
                    aria-pressed={selectedChain === "solana"}
                    onClick={() => setSelectedChain("solana")}
                    className={cn(
                      "ui-public-site-card flex min-h-20 items-center gap-3 p-3.5 text-left transition-all",
                      selectedChain === "solana" &&
                        "border-[var(--app-accent)] bg-[var(--app-panel-raised)] ring-1 ring-[var(--app-accent)]",
                    )}
                  >
                    <VenueMark venue="solana" className="h-9 w-9" />
                    <span>
                      <span className="block text-sm font-semibold">Pump.fun</span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        Available now
                      </span>
                    </span>
                    {selectedChain === "solana" ? (
                      <Check className="ml-auto h-4 w-4 text-emerald-400" />
                    ) : null}
                  </button>
                  <button
                    type="button"
                    aria-pressed={selectedChain === "metaplex"}
                    onClick={() => setSelectedChain("metaplex")}
                    className={cn(
                      "cx-public-market-card flex min-h-20 items-center gap-3 p-3.5 text-left transition-all",
                      selectedChain === "metaplex" &&
                        "border-[var(--console-accent)] bg-[var(--console-panel-raised)] ring-1 ring-[var(--console-accent)]",
                    )}
                  >
                    <VenueMark venue="metaplex" className="h-9 w-9" />
                    <span>
                      <span className="block text-sm font-semibold">Metaplex Genesis</span>
                      <span className="text-muted-foreground mt-0.5 block text-xs">
                        Available now
                      </span>
                    </span>
                    {selectedChain === "metaplex" ? (
                      <Check className="ml-auto h-4 w-4 text-emerald-400" />
                    ) : null}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  aria-pressed
                  onClick={() => setSelectedChain("robinhood")}
                  className="ui-public-site-card flex min-h-20 items-center gap-3 border-[var(--app-accent)] bg-[var(--app-panel-raised)] p-3.5 text-left ring-1 ring-[var(--app-accent)] transition-all sm:col-span-2"
                >
                  <VenueMark venue="robinhood" className="h-9 w-9" />
                  <span>
                    <span className="block text-sm font-semibold">Robinhood Chain</span>
                    <span className="text-muted-foreground mt-0.5 block text-xs">
                      EVM factory · Available now
                    </span>
                  </span>
                  <Check className="ml-auto h-4 w-4 text-emerald-400" />
                </button>
              )}
            </div>
          </div>
        </PublicSitePanel>
        <PublicSitePanel className="p-0">
          <div className="border-b border-[var(--app-border)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
                2
              </span>
              <div>
                <p className="text-sm font-semibold">Connect creator wallet</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {selectedChain === "robinhood"
                    ? "Your connected wallet signs the Robinhood launch and pays gas."
                    : selectedChain === "metaplex"
                      ? "Your connected Phantom pays launch fees in one approval, then Genesis continues."
                      : "Your connected Phantom signs the Pump.fun launch and owns creator-fee rights."}
                </p>
              </div>
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{chainLabel(selectedChain)}</p>
                <p className="text-muted-foreground text-xs">
                  {(selectedChain === "solana" || selectedChain === "metaplex") &&
                  solBalance != null
                    ? ` · ${solBalance} SOL`
                    : ""}
                  {selectedChain === "robinhood" && launchFeeEth != null
                    ? Number(launchFeeEth) > 0
                      ? ` · fee ${launchFeeEth} ETH`
                      : " · gas only"
                    : ""}
                </p>
                {walletSession.authenticated ? (
                  <p className="mt-1 text-xs text-emerald-400">Verified launch session active</p>
                ) : sessionLoading ? (
                  <p className="text-muted-foreground mt-1 text-xs">Checking session…</p>
                ) : (
                  <p className="text-muted-foreground mt-1 text-xs">Sign once to secure drafts and uploads</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedChain === "solana" || selectedChain === "metaplex" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void solWallet.connect()}
                    disabled={solWallet.connecting}
                  >
                    {solWallet.connected ? "Reconnect Phantom" : "Connect Phantom"}
                  </Button>
                ) : selectedChain === "robinhood" ? (
                  <>
                    <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
                    {!onRobinhoodChain && isConnected ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={switchingChain}
                        onClick={() => void switchChain({ chainId: ROBINHOOD_CHAIN_ID })}
                      >
                        Switch network
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {walletSession.authenticated ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void logoutLaunchWalletSession().then(refreshSession)}
                  >
                    End session
                  </Button>
                ) : null}
              </div>
            </div>
            {activeWallet ? (
              <div className="mt-4 rounded-lg border border-[var(--app-border)] bg-black/10 px-3 py-2.5">
                <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">
                  Creator address
                </p>
                <p className="mt-1 break-all font-mono text-xs">{activeWallet}</p>
              </div>
            ) : null}
          </div>
        </PublicSitePanel>
        <PublicSitePanel className="p-0">
          <div className="border-b border-[var(--app-border)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
                3
              </span>
              <div>
                <p className="text-sm font-semibold">Create token profile</p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Clear metadata helps traders identify and discover your token.
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-6 p-4 sm:p-6">
            <div>
              <Label>Token artwork</Label>
              <button
                type="button"
                className={cn(
                  "mt-2 flex w-full flex-col items-center justify-center rounded-xl border border-dashed px-5 py-7 text-center transition-colors sm:min-h-48 sm:flex-row sm:justify-start sm:text-left",
                  draggingImage
                    ? "border-[var(--app-accent)] bg-[var(--app-panel-raised)]"
                    : "border-[var(--app-border)] bg-black/10 hover:bg-[var(--app-panel-raised)]",
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDraggingImage(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDraggingImage(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDraggingImage(false);
                  const file = event.dataTransfer.files[0];
                  if (file) handleImageFile(file);
                }}
                disabled={uploading}
              >
                {form.tokenImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.tokenImageUrl}
                    alt="Token artwork preview"
                    className="h-28 w-28 rounded-2xl border border-[var(--app-border)] object-cover shadow-lg sm:h-32 sm:w-32"
                  />
                ) : (
                  <span className="flex h-24 w-24 items-center justify-center rounded-2xl border border-[var(--app-border)] bg-[var(--app-panel)] sm:h-28 sm:w-28">
                    {uploading ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : (
                      <ImagePlus className="text-muted-foreground h-7 w-7" />
                    )}
                  </span>
                )}
                <span className="mt-4 sm:ml-6 sm:mt-0">
                  <span className="block text-sm font-semibold">
                    {artworkLabel}
                  </span>
                  <span className="text-muted-foreground mt-1 block max-w-md text-xs leading-5">
                    PNG, JPG or WebP up to 5 MB. Images are center-cropped and optimized to 512×512 using the same pipeline as app launches.
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium">
                    <Upload className="h-3.5 w-3.5" />
                    Choose image
                  </span>
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleImageFile(file);
                }}
              />
              {form.tokenImageUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="mt-2"
                  onClick={() => update("tokenImageUrl", "")}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remove image
                </Button>
              ) : null}
            </div>
            <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.4fr)]">
              <div className="space-y-2">
                <Label htmlFor="tokenName">Name</Label>
                <Input
                  id="tokenName"
                  value={form.tokenName}
                  onChange={(e) => update("tokenName", e.target.value)}
                  placeholder="My Token"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="tokenSymbol">Symbol</Label>
                <Input
                  id="tokenSymbol"
                  value={form.tokenSymbol}
                  onChange={(e) => update("tokenSymbol", e.target.value.toUpperCase())}
                  placeholder="MTK"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tokenDescription">Description</Label>
              <Textarea
                id="tokenDescription"
                value={form.tokenDescription}
                onChange={(e) => update("tokenDescription", e.target.value)}
                rows={5}
                className="min-h-32 resize-y"
                placeholder="Explain what the token represents, who it is for, and why it exists."
              />
            </div>
            <div className="border-t border-[var(--app-border)] pt-5">
              <p className="text-sm font-medium">Links &amp; community</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Optional, but recommended for public token discovery.
              </p>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="website">Website (optional)</Label>
                <Input
                  id="website"
                  value={form.website}
                  onChange={(event) => update("website", event.target.value)}
                  placeholder="https://yourproject.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="twitter">Twitter (optional)</Label>
                <Input
                  id="twitter"
                  value={form.twitter}
                  onChange={(e) => update("twitter", e.target.value)}
                  placeholder="https://x.com/..."
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="telegram">Telegram (optional)</Label>
                <Input
                  id="telegram"
                  value={form.telegram}
                  onChange={(event) => update("telegram", event.target.value)}
                  placeholder="https://t.me/..."
                />
              </div>
            </div>
          </div>
        </PublicSitePanel>
        <PublicSitePanel className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Review & launch</p>
                <p className="text-muted-foreground text-xs">
                  {selectedChain === "solana"
                    ? `Platform fee ${feeDisplay.platformFeeSol ?? "0"} SOL + network costs`
                    : selectedChain === "metaplex"
                      ? "~0.055 SOL from your Phantom (one approval) for Irys + Genesis"
                      : "Your connected wallet pays factory fee + gas on Robinhood Chain"}
                </p>
                <LaunchReviewSummary chain={selectedChain} tokenSymbol={form.tokenSymbol} />
                {selectedChain === "metaplex" ? (
                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-5">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={metaplexBindChecked}
                      onChange={(event) => setMetaplexBindChecked(event.target.checked)}
                    />
                    <span>
                      I understand this permanently binds the Genesis token to a new Metaplex agent
                      created for this launch.
                    </span>
                  </label>
                ) : null}
                {launching && launchPhase !== "idle" ? (
                  <p className="mt-2 flex items-center gap-2 text-xs text-[var(--ar-text-secondary)]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {phaseLabel(launchPhase)}
                  </p>
                ) : null}
                {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
              </div>
              <Button type="button" disabled={!canLaunch} onClick={() => void onLaunch()}>
                {launching || signingSession ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Launching…
                  </>
                ) : (
                  <>
                    <Rocket className="mr-2 h-4 w-4" />
                    {selectedChain === "metaplex" ? "Launch agent + token" : "Launch token"}
                  </>
                )}
              </Button>
            </div>
        </PublicSitePanel>
      </div>
    </PublicSitePageShell>
  );
}
