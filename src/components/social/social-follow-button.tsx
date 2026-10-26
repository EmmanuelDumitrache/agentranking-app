"use client";
import { Loader2, UserMinus, UserPlus } from "lucide-react";
import { useProfileFollow, type UseProfileFollowOptions } from "@/hooks/use-profile-follow";
import { cn } from "@/lib/utils";
type SocialFollowButtonProps = {
  readonly targetWallet: string;
  readonly followOptions?: UseProfileFollowOptions;
  readonly className?: string;
  readonly initialFollowerAddress?: string | null;
  readonly initialFollowing?: boolean;
};
export function SocialFollowButton({
  targetWallet,
  followOptions,
  className,
  initialFollowerAddress,
  initialFollowing,
}: SocialFollowButtonProps) {
  const { isFollowing, followLoading, authReady, isSelf, toggleFollow } = useProfileFollow(
    targetWallet,
    { ...followOptions, initialFollowerAddress, initialFollowing },
  );
  if (isSelf) return null;
  const title = !authReady ? "Loading account…" : isFollowing ? "Unfollow" : "Follow";
  return (
    <button
      type="button"
      className={cn(
        "ar-btn ar-btn-secondary social-follow-btn",
        isFollowing && "social-follow-btn--active",
        className,
      )}
      disabled={followLoading || !authReady}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void toggleFollow();
      }}
      title={title}
      aria-label={title}
      aria-pressed={isFollowing}
    >
      {followLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      ) : isFollowing ? (
        <UserMinus className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <UserPlus className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}
