"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAddress, isAddress } from "viem";
import { useAccount, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/button";
import { Wallet } from "lucide-react";
import { GoogleLogo } from "@/components/shared/brand-icons";
import { AgentRankingWordmark } from "@/components/layout/agent-ranking-wordmark";
import { signInWithTwitter } from "@/lib/auth-twitter-client";

const CALLBACK_AFTER_AUTH = "/dashboard";

export function RegisterForm({
  error,
  twitterAvailable,
}: {
  readonly error: string | null;
  readonly twitterAvailable: boolean;
}) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();
  const [loading, setLoading] = useState(false);
  const [walletError, setWalletError] = useState("");
  const oauthErrors: Record<string, string> = {
    OAuthSignin: "Could not start Google or X sign-up. Try again.",
    OAuthCallback:
      "OAuth could not complete the redirect. Use the exact same origin as in each developer console authorized callback URLs, try a private window, clear site data, or use Continue with wallet.",
    Default: "Sign-up failed. Try again or use your wallet.",
  };
  async function handleGoogle() {
    setLoading(true);
    await signIn("google", { callbackUrl: CALLBACK_AFTER_AUTH });
  }
  async function handleTwitter() {
    setLoading(true);
    await signInWithTwitter(CALLBACK_AFTER_AUTH);
  }
  async function handleWalletSignUp() {
    setWalletError("");
    if (!isConnected || !address) {
      openConnectModal?.();
      setWalletError("Connect your wallet, then tap again.");
      return;
    }
    if (!isAddress(address)) {
      setWalletError("Invalid wallet address.");
      return;
    }
    setLoading(true);
    try {
      const checksummed = getAddress(address);
      const issued = new Date().toISOString();
      const message = `AgentRanking Agent Dashboard sign-in\n\nWallet: ${checksummed}\nIssued At: ${issued}`;
      const signature = await signMessageAsync({ message });
      const result = await signIn("wallet", {
        address: checksummed,
        message,
        signature,
        redirect: false,
        callbackUrl: CALLBACK_AFTER_AUTH,
      });
      if (result?.error) {
        setWalletError(
          "This wallet is not linked yet. If you subscribed with Helio, include this wallet in checkout metadata (walletAddress), verify an agent owned by this wallet, or use Google with the same email as your subscription.",
        );
      } else {
        router.push(CALLBACK_AFTER_AUTH);
      }
    } catch (cause) {
      console.error("[sign-up] wallet:", cause);
      setWalletError("Signature was cancelled or failed. Try again.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="ui-auth-youtube flex min-h-screen items-center justify-center bg-[#0f0f0f] px-4 py-10 text-[#f1f1f1]">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Link href="/">
            <AgentRankingWordmark className="h-8" />
          </Link>
        </div>
        <div className="ui-auth-youtube__panel space-y-6 rounded-xl border border-[#303030] bg-[#181818] p-6 sm:p-8">
          <div className="text-center space-y-1">
            <h1 className="text-xl font-semibold tracking-tight text-[#f1f1f1]">Join Agent Dashboard</h1>
            <p className="text-sm text-[#aaa]">
              Create your account, then we&apos;ll walk you through setup (name, wallet link, and unlock steps).
            </p>
          </div>
          {error ? (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm px-4 py-3 space-y-2">
              <p>{oauthErrors[error] ?? oauthErrors.Default}</p>
              {error === "OAuthCallback" ? (
                <p className="text-xs text-red-300/90">
                  In Google Cloud Dashboard, add both{" "}
                  <code className="rounded bg-black/30 px-1">https://app.agentranking.io/api/auth/callback/google</code>{" "}
                  and set NEXTAUTH_URL to https://app.agentranking.io in the production app environment.
                </p>
              ) : null}
            </div>
          ) : null}
          <ol className="ui-auth-youtube__inset list-inside list-decimal space-y-2 rounded-lg border border-[#303030] bg-[#212121] p-4 text-xs text-[#aaa]">
            <li>Sign up with Google, X, or your paying / agent wallet.</li>
            <li>Review the Agent Dashboard claim and verification workflow.</li>
            <li>Subscribe or verify an agent to unlock creator tools when access opens.</li>
          </ol>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="ui-auth-youtube__button ui-auth-youtube__button--primary h-11 w-full gap-2 rounded-full border-0 bg-[#f1f1f1] text-[#0f0f0f] hover:bg-white"
              onClick={() => void handleGoogle()}
              disabled={loading}
            >
              <GoogleLogo className="h-4 w-4" />
              Continue with Google
            </Button>
            {twitterAvailable ? (
              <Button
                variant="outline"
                className="ui-auth-youtube__button ui-auth-youtube__button--primary h-11 w-full gap-2 rounded-full border-0 bg-[#f1f1f1] text-[#0f0f0f] hover:bg-white"
                onClick={() => void handleTwitter()}
                disabled={loading}
              >
                <span className="text-base font-semibold leading-none" aria-hidden>
                  𝕏
                </span>
                Continue with X
              </Button>
            ) : null}
            <Button
              variant="outline"
              className="ui-auth-youtube__button ui-auth-youtube__button--secondary h-11 w-full gap-2 rounded-full border border-[#303030] bg-[#212121] text-[#f1f1f1] hover:bg-[#303030]"
              onClick={() => void handleWalletSignUp()}
              disabled={loading}
            >
              <Wallet className="h-4 w-4" />
              Continue with wallet
            </Button>
          </div>
          {walletError ? <p className="text-center text-sm text-amber-300">{walletError}</p> : null}
          <div className="space-y-2 border-t border-[#303030] pt-4 text-center text-xs text-[#aaa]">
            <p>
              Already have access?{" "}
              <Link href="/auth/login" className="text-[#f1f1f1] hover:underline">
                Sign in
              </Link>
            </p>
            <p>
              Need to verify an agent first?{" "}
              <Link href="/verified" className="text-[#f1f1f1] hover:underline">
                Verify
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
