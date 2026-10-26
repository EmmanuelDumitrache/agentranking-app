"use client";
import { useCallback, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, useSignMessage } from "wagmi";
import { isAddress } from "viem";
import { showToast } from "@/components/ui/toast-simple";
import { useAsyncResource } from "@/hooks/use-async-resource";
import { truncateAddress } from "@/lib/utils";
import { establishLaunchWalletSessionWithSigner } from "@/lib/launch-wallet-session/client";
type FollowApiError = {
  error?: string;
  code?: string;
};
export type UseProfileFollowOptions = {
  targetLabel?: string;
  onSuccess?: () => void;
  initialFollowerAddress?: string | null;
  initialFollowing?: boolean;
};
export function useProfileFollow(
  targetWallet: string,
  options: UseProfileFollowOptions = {},
) {
  const { data: session, status: sessionStatus } = useSession();
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { openConnectModal } = useConnectModal();
  const [followOverride, setFollowOverride] = useState<{ key: string; value: boolean } | null>(null);
  const [followLoading, setFollowLoading] = useState(false);
  const { targetLabel: targetLabelOpt, onSuccess, initialFollowerAddress, initialFollowing } = options;
  const target = targetWallet.trim().toLowerCase();
  const targetLabel = targetLabelOpt?.trim() || truncateAddress(target, 6);
  const sessionWallet = session?.user?.walletAddress?.trim().toLowerCase() ?? null;
  const connected = connectedAddress?.trim().toLowerCase() ?? null;
  const loadProfileWallet = useCallback(async (signal: AbortSignal): Promise<string | null> => {
    if (sessionStatus !== "authenticated" || connected) return null;
    const response = await fetch("/api/dashboard/profile", {
      cache: "no-store",
      credentials: "include",
      signal,
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { profile?: { walletAddress?: string | null } };
    const wallet = data.profile?.walletAddress?.trim().toLowerCase() ?? null;
    return wallet && isAddress(wallet) ? wallet : null;
  }, [sessionStatus, connected]);
  const profileWalletKey = `profile-follow-wallet:${sessionStatus}:${connected ?? "none"}`;
  const profileWalletResource = useAsyncResource(
    profileWalletKey,
    loadProfileWallet,
    {
      initialData: initialFollowerAddress ?? null,
      initialDataKey: initialFollowerAddress && !connected ? profileWalletKey : null,
      revalidateOnMount: false,
    },
  );
  const profileWallet = profileWalletResource.data;
  const followerAddress = useMemo(() => {
    if (connected && isAddress(connected)) return connected;
    if (sessionWallet && isAddress(sessionWallet)) return sessionWallet;
    if (profileWallet && isAddress(profileWallet)) return profileWallet;
    if (initialFollowerAddress && isAddress(initialFollowerAddress)) return initialFollowerAddress.toLowerCase();
    return null;
  }, [connected, sessionWallet, profileWallet, initialFollowerAddress]);
  const isSelf = Boolean(followerAddress && followerAddress === target);
  const canCheckStatus = Boolean(followerAddress) && !isSelf;
  const authReady = Boolean(connected || initialFollowerAddress) || sessionStatus !== "loading";
  const followKey = `${followerAddress ?? "anonymous"}:${target}`;
  const loadFollowStatus = useCallback(async (signal: AbortSignal): Promise<boolean> => {
    if (!canCheckStatus || !target || !followerAddress) return false;
    const q = new URLSearchParams({ following: target, follower: followerAddress });
    const response = await fetch(`/api/profiles/follow?${q}`, {
      credentials: "include",
      signal,
    });
    if (!response.ok) return false;
    const data = (await response.json()) as { isFollowing?: boolean };
    return Boolean(data.isFollowing);
  }, [canCheckStatus, target, followerAddress]);
  const followStatusKey = `profile-follow-status:${followKey}:${canCheckStatus}`;
  const normalizedInitialFollower = initialFollowerAddress?.trim().toLowerCase() ?? null;
  const hasMatchingInitialFollow =
    initialFollowing !== undefined &&
    normalizedInitialFollower !== null &&
    normalizedInitialFollower === followerAddress;
  const followStatusResource = useAsyncResource(
    followStatusKey,
    loadFollowStatus,
    {
      initialData: initialFollowing ?? false,
      initialDataKey: hasMatchingInitialFollow ? followStatusKey : null,
      revalidateOnMount: false,
    },
  );
  const serverFollowing = followStatusResource.data ?? false;
  const isFollowing = followOverride?.key === followKey ? followOverride.value : serverFollowing;
  const toggleFollow = useCallback(async () => {
    if (isSelf) return;
    if (!followerAddress) {
      showToast("Connect a wallet to follow builders", "info");
      openConnectModal?.();
      return;
    }
    setFollowLoading(true);
    const wasFollowing = isFollowing;
    setFollowOverride({ key: followKey, value: !wasFollowing });
    try {
      const submit = () => fetch("/api/profiles/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            followerAddress,
            followingAddress: target,
            action: wasFollowing ? "unfollow" : "follow",
          }),
        });
      let res = await submit();
      let data = (await res.json()) as FollowApiError & { followed?: boolean };
      if (
        !res.ok
        && data.code === "WALLET_SESSION_REQUIRED"
        && connected
        && isAddress(connected)
      ) {
        await establishLaunchWalletSessionWithSigner({
          chain: "evm",
          wallet: connected,
          signMessage: (message) => signMessageAsync({ message }),
        });
        res = await submit();
        data = (await res.json()) as FollowApiError & { followed?: boolean };
      }
      if (!res.ok) {
        setFollowOverride({ key: followKey, value: wasFollowing });
        showToast(data.error ?? "Could not update follow", "error");
        return;
      }
      const nowFollowing = Boolean(data.followed);
      setFollowOverride({ key: followKey, value: nowFollowing });
      showToast(
        nowFollowing ? `Following ${targetLabel}` : `Unfollowed ${targetLabel}`,
        "success",
      );
      onSuccess?.();
    } catch {
      setFollowOverride({ key: followKey, value: wasFollowing });
      showToast("Could not update follow", "error");
    } finally {
      setFollowLoading(false);
    }
  }, [
    isSelf,
    followerAddress,
    openConnectModal,
    isFollowing,
    target,
    targetLabel,
    onSuccess,
    followKey,
    connected,
    signMessageAsync,
  ]);
  return {
    isFollowing,
    followLoading,
    isSelf,
    authReady,
    toggleFollow,
    followerAddress,
  };
}
