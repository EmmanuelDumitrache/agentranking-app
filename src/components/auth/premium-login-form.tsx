"use client";
import { useCallback, useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAddress, isAddress } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowLeft, Sparkles, Wallet } from "lucide-react";
import { GoogleLogo } from "@/components/shared/brand-icons";
import { AuthForm } from "@/components/auth/auth-form";
import { AuthEmailAuthBlock } from "@/components/auth/auth-email-auth-block";
import { AuthWaveBackground } from "@/components/auth/auth-wave-background";
import { DEFAULT_APP_POST_LOGIN_PATH, normalizeAppCallbackPath, buildSignInCallbackUrl } from "@/lib/app-auth-routes";
import { signInWithTwitter } from "@/lib/auth-twitter-client";
import { signInWithPhantom, syncSolanaWalletToProfile } from "@/lib/solana-auth-sign-in";
import { getSolanaWalletProvider } from "@/lib/ar-token-ledger";
import { useBrowserEvmWalletAvailability } from "@/hooks/use-browser-evm-wallet-availability";
export function PremiumLoginForm({
  twitterAvailable,
  publicSiteUrl,
}: {
  readonly twitterAvailable: boolean;
  readonly publicSiteUrl: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const callbackUrl = normalizeAppCallbackPath(
    searchParams.get("callbackUrl") ?? DEFAULT_APP_POST_LOGIN_PATH,
  );
  const signInCallbackUrl = buildSignInCallbackUrl(callbackUrl);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [xLoading, setXLoading] = useState(false);
  const [phantomLoading, setPhantomLoading] = useState(false);
  const [evmLoading, setEvmLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const evmWalletAvailable = useBrowserEvmWalletAvailability();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();
  // Break out of the <main> container margin applied by sidebar CSS.
  useEffect(() => {
    const main = document.querySelector<HTMLElement>("main[data-app-shell-main]");
    if (!main) return;
    main.style.setProperty("margin-left", "0", "important");
    main.style.setProperty("margin-right", "0", "important");
    main.style.setProperty("width", "100%", "important");
    return () => {
      main.style.removeProperty("margin-left");
      main.style.removeProperty("margin-right");
      main.style.removeProperty("width");
    };
  }, []);
  const handleGoogleSignIn = useCallback(() => {
    setGoogleLoading(true);
    const oauthOrigin =
      typeof window !== "undefined" &&
      window.location.hostname === "app.agentranking.localhost"
        ? `http://localhost:${window.location.port || "3000"}`
        : null;
    if (oauthOrigin) {
      const params = new URLSearchParams({ callbackUrl: signInCallbackUrl });
      // This is intentionally a full document navigation to the sibling localhost
      // origin; the Next router cannot cross origins during local OAuth.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`${oauthOrigin}/api/auth/signin/google?${params.toString()}`);
      return;
    }
    void signIn("google", { callbackUrl: signInCallbackUrl });
  }, [signInCallbackUrl]);
  const handleXSignIn = useCallback(() => {
    setXLoading(true);
    void signInWithTwitter(signInCallbackUrl).catch(() => setXLoading(false));
  }, [signInCallbackUrl]);
  const handlePhantomSignIn = useCallback(async () => {
    setWalletError("");
    setPhantomLoading(true);
    try {
      const result = await signInWithPhantom({ callbackUrl: signInCallbackUrl });
      if (result.ok) {
        const pk = getSolanaWalletProvider()?.publicKey?.toBase58();
        if (pk) await syncSolanaWalletToProfile(pk);
        router.push(signInCallbackUrl);
      } else if (!result.cancelled) {
        setWalletError(result.error);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Phantom sign-in failed.";
      setWalletError(
        /reading ['"]?call['"]?/i.test(raw)
          ? "Wallet sign-in hit a stale app bundle. Hard-refresh (Cmd+Shift+R) and try again."
          : raw,
      );
    } finally {
      setPhantomLoading(false);
    }
  }, [router, signInCallbackUrl]);
  const handleEvmWalletSignIn = useCallback(async () => {
    setWalletError("");
    if (!evmWalletAvailable) {
      setWalletError("Install an EVM wallet or use Continue with Phantom for Solana.");
      return;
    }
    if (!isConnected || !address) {
      openConnectModal?.();
      setWalletError("Connect your EVM wallet, then tap again to sign in.");
      return;
    }
    if (!isAddress(address)) {
      setWalletError("Invalid wallet address.");
      return;
    }
    setEvmLoading(true);
    try {
      const checksummed = getAddress(address);
      const issued = new Date().toISOString();
      const message = `AgentRanking Agent Console sign-in\n\nWallet: ${checksummed}\nIssued At: ${issued}`;
      const signature = await signMessageAsync({ message });
      const result = await signIn("wallet", {
        address: checksummed,
        message,
        signature,
        redirect: false,
        callbackUrl: signInCallbackUrl,
      });
      if (result?.error) {
        setWalletError("Wallet sign-in failed. Try again.");
      } else {
        router.push(signInCallbackUrl);
      }
    } catch {
      setWalletError("Signature was cancelled or failed. Try again.");
    } finally {
      setEvmLoading(false);
    }
  }, [address, evmWalletAvailable, isConnected, openConnectModal, router, signInCallbackUrl, signMessageAsync]);
  const anyLoading = googleLoading || xLoading || phantomLoading || evmLoading;
  return (
    <div className="ui-auth-youtube fixed inset-0 z-40 flex overflow-hidden text-[#f1f1f1]">
      <AuthWaveBackground />
      <div className="relative z-10 mx-auto flex h-full w-full max-w-lg flex-col items-center justify-center overflow-y-auto px-6 py-8">
        <a
          href={publicSiteUrl}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-[#aaa] transition-colors hover:text-[#f1f1f1]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AgentRanking
        </a>
        <AuthForm
          logoSrc="/ar-mark.png"
          logoAlt="AgentRanking"
          title="Agent Ranking Dashboard"
          description="Create agents, launch tokens, and manage on-chain revenue from one workspace."
          primaryAction={{
            label: googleLoading ? "Signing in…" : "Continue with Google",
            icon: googleLoading ? undefined : <GoogleLogo className="h-5 w-5" />,
            onClick: handleGoogleSignIn,
            loading: googleLoading,
          }}
          socialActions={twitterAvailable ? [
            {
              label: xLoading ? "Signing in…" : "Continue with X",
              icon: xLoading ? undefined : (
                <span className="text-base font-semibold leading-none" aria-hidden>
                  𝕏
                </span>
              ),
              onClick: handleXSignIn,
              disabled: anyLoading,
              loading: xLoading,
              matchPrimary: true,
            },
          ] : []}
          emailSection={
            <AuthEmailAuthBlock callbackUrl={callbackUrl} disabled={anyLoading} />
          }
          walletActions={[
            {
              label: phantomLoading ? "Signing in…" : "Continue with wallet",
              icon: phantomLoading ? undefined : <Wallet className="h-5 w-5" />,
              onClick: () => void handlePhantomSignIn(),
              disabled: anyLoading,
              loading: phantomLoading,
              matchPrimary: true,
            },
            ...(evmWalletAvailable
              ? [
                  {
                    label: evmLoading ? "Signing in…" : "Continue with EVM wallet",
                    icon: evmLoading ? undefined : <Wallet className="h-5 w-5" />,
                    onClick: () => void handleEvmWalletSignIn(),
                    disabled: anyLoading,
                    loading: evmLoading,
                    matchPrimary: false,
                  },
                ]
              : []),
          ]}
        />
        {walletError ? (
          <div className="mt-4 w-full rounded-lg border border-[#303030] bg-[#212121] px-4 py-3 text-center text-sm text-[#f1f1f1]">
            {walletError}
          </div>
        ) : null}
        {error && (
          <div className="mt-4 w-full space-y-1 rounded-lg border border-[#303030] bg-[#212121] px-4 py-3 text-center text-sm text-red-300">
            <p>
              {error === "OAuthCallback" || error === "OAuthSignin"
                ? "X / Google sign-in could not finish. In the X Developer Portal, add this exact callback URL, then try again:"
                : error === "OAuthAccountNotLinked" || error === "provider_linked_elsewhere"
                  ? "That X account is already linked to a different AgentRanking user."
                  : error === "AccessDenied"
                    ? "Sign-in was cancelled or denied."
                    : error === "undefined" || !error
                      ? "Sign-in failed. If you used X, confirm the callback URL below is registered, then retry."
                      : "Sign-in failed. Please try again."}
            </p>
            {(error === "OAuthCallback" ||
              error === "OAuthSignin" ||
              error === "undefined") && (
              <div className="space-y-1 break-all font-mono text-[11px] text-red-200/90">
                <p>{typeof window !== "undefined" ? window.location.origin : "http://app.agentranking.localhost:3000"}/api/auth/callback/google</p>
                <p>{typeof window !== "undefined" ? window.location.origin : "http://app.agentranking.localhost:3000"}/api/auth/callback/twitter</p>
              </div>
            )}
          </div>
        )}
        <div className="ui-auth-youtube__inset mt-5 flex w-full items-start gap-2.5 rounded-lg border border-[#303030] bg-[#181818] px-4 py-3">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#aaa]" />
          <p className="text-xs text-[#aaa]">
            New accounts get <span className="font-medium text-[#f1f1f1]">3 free agents</span>.
            Every agent gets its own Solana wallet for token launches and creator fee rewards.
          </p>
        </div>
      </div>
    </div>
  );
}