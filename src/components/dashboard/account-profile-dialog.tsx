"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { AgentAvatar } from "@/components/shared/agent-avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast-simple";
import { dashboardKeys } from "@/lib/query-keys/dashboard";

type AccountProfile = {
  displayName: string;
  username: string;
  bio: string;
  avatarUrl: string;
};

type Props = Readonly<{
  open: boolean;
  initialName: string;
  initialAvatar: string | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (profile: Pick<AccountProfile, "displayName" | "avatarUrl">) => void;
}>;

const EMPTY_PROFILE: AccountProfile = {
  displayName: "",
  username: "",
  bio: "",
  avatarUrl: "",
};

export function AccountProfileDialog({
  open,
  initialName,
  initialAvatar,
  onOpenChange,
  onUpdated,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<AccountProfile>(() => ({
    ...EMPTY_PROFILE,
    displayName: initialName,
    avatarUrl: initialAvatar ?? "",
  }));
  const [uploading, setUploading] = useState(false);
  const hydratedRef = useRef(false);

  const profileQuery = useQuery({
    queryKey: dashboardKeys.accountProfile(),
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/dashboard/profile", {
        cache: "no-store",
        signal,
      });
      const payload = (await response.json()) as {
        profile?: Partial<AccountProfile> | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load your profile");
      }
      return payload.profile ?? null;
    },
    enabled: open,
    staleTime: 30_000,
  });
  const loading = open && profileQuery.isPending;

  useEffect(() => {
    if (open) hydratedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || hydratedRef.current) return;
    if (profileQuery.isError) {
      showToast("Could not load your profile", "error");
      hydratedRef.current = true;
      return;
    }
    const data = profileQuery.data;
    if (!data) return;
    hydratedRef.current = true;
    queueMicrotask(() => {
      setProfile({
        displayName: data.displayName?.trim() || initialName,
        username: data.username?.trim() || "",
        bio: data.bio?.trim() || "",
        avatarUrl: data.avatarUrl?.trim() || initialAvatar?.trim() || "",
      });
    });
  }, [initialAvatar, initialName, open, profileQuery.data, profileQuery.isError]);

  const uploadAvatar = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/upload/agent-image", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? "Avatar upload failed");
      }
      setProfile((current) => ({ ...current, avatarUrl: payload.url ?? "" }));
      showToast("Profile image ready. Save to apply it.", "success");
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Avatar upload failed",
        "error",
      );
    } finally {
      setUploading(false);
    }
  }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/dashboard/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: profile.displayName,
          username: profile.username,
          bio: profile.bio,
          avatarUrl: profile.avatarUrl,
        }),
      });
      const payload = (await response.json()) as {
        profile?: Partial<AccountProfile> | null;
        error?: string;
      };
      if (!response.ok || !payload.profile) {
        throw new Error(payload.error ?? "Could not update your profile");
      }
      return payload.profile;
    },
    onSuccess: (updatedProfile) => {
      const displayName = profile.displayName.trim();
      const updated = {
        displayName: updatedProfile.displayName?.trim() || displayName,
        avatarUrl: updatedProfile.avatarUrl?.trim() || profile.avatarUrl,
      };
      queryClient.setQueryData<Partial<AccountProfile> | null>(
        dashboardKeys.accountProfile(),
        updated,
      );
      onUpdated(updated);
      showToast("Account profile updated.", "success");
      onOpenChange(false);
      router.refresh();
    },
    onError: (error) => {
      showToast(
        error instanceof Error ? error.message : "Could not update your profile",
        "error",
      );
    },
  });
  const saveProfile = useCallback(async () => {
    const displayName = profile.displayName.trim();
    if (!displayName) {
      showToast("Enter a display name.", "error");
      return;
    }
    await saveMutation.mutateAsync();
  }, [profile.displayName, saveMutation]);

  const saving = saveMutation.isPending;
  const busy = loading || saving || uploading;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[#303030] bg-[#181818] p-0 sm:max-w-md">
        <DialogHeader className="border-b border-white/10 px-5 py-4">
          <DialogTitle className="text-left text-base">Account profile</DialogTitle>
          <DialogDescription className="text-left">
            Update the identity shown in your creator workspace.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-56 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading profile…
          </div>
        ) : (
          <div className="space-y-5 px-5 py-5">
            <div className="flex items-center gap-4">
              <AgentAvatar
                image={profile.avatarUrl}
                name={profile.displayName || initialName}
                size="lg"
                className="shrink-0 rounded-full"
              />
              <div className="min-w-0">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#303030] px-4 py-2 text-sm font-medium transition-colors hover:bg-[#3f3f3f]">
                  {uploading ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus className="size-4" aria-hidden />
                  )}
                  {uploading ? "Uploading…" : "Change image"}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="sr-only"
                    disabled={busy}
                    onChange={(event) => {
                      void uploadAvatar(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </label>
                <p className="mt-2 text-xs text-muted-foreground">
                  PNG, JPEG, WebP, or GIF.
                </p>
              </div>
            </div>

            <label className="block space-y-1.5 text-sm font-medium">
              <span>Display name</span>
              <Input
                value={profile.displayName}
                maxLength={100}
                disabled={busy}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    displayName: event.target.value,
                  }))
                }
                placeholder="Your name"
                className="border-[#303030] bg-[#0f0f0f]"
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium">
              <span>Username</span>
              <Input
                value={profile.username}
                maxLength={50}
                disabled={busy}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    username: event.target.value,
                  }))
                }
                placeholder="username"
                autoCapitalize="none"
                className="border-[#303030] bg-[#0f0f0f]"
              />
            </label>

            <label className="block space-y-1.5 text-sm font-medium">
              <span>Bio</span>
              <textarea
                value={profile.bio}
                maxLength={500}
                rows={4}
                disabled={busy}
                onChange={(event) =>
                  setProfile((current) => ({
                    ...current,
                    bio: event.target.value,
                  }))
                }
                placeholder="Tell people about yourself"
                className="w-full resize-y rounded-lg border border-[#303030] bg-[#0f0f0f] px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-[#717171]"
              />
            </label>
          </div>
        )}

        <DialogFooter className="border-t border-white/10 px-5 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || !profile.displayName.trim()}
            onClick={() => void saveProfile()}
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Save profile
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
