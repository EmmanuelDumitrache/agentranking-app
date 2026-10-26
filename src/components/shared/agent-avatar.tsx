"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useState } from "react";
import { resolveImageUrl, uploadPreviewFallbackSrc } from "@/lib/image-utils";
import { Bot } from "lucide-react";

interface AgentAvatarProps {
  image?: string | null;
  name?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Default lazy; set eager for above-the-fold / LCP avatars */
  loading?: "lazy" | "eager";
  /** Hide the image from assistive tech when nearby text already names the agent. */
  decorative?: boolean;
}

const sizeClasses = {
  sm: "h-8 w-8",
  md: "h-12 w-12",
  lg: "h-16 w-16",
};

const iconSizes = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
};

export function AgentAvatar({
  image,
  name,
  size = "md",
  className = "",
  loading = "lazy",
  decorative = false,
}: AgentAvatarProps) {
  const resolved = resolveImageUrl(image);
  const sourceIdentity = image ?? null;
  const [imageState, setImageState] = useState(() => ({
    sourceIdentity,
    resolved,
    src: resolved,
    fallbackAttempted: false,
    failed: false,
  }));

  if (imageState.sourceIdentity !== sourceIdentity || imageState.resolved !== resolved) {
    setImageState({
      sourceIdentity,
      resolved,
      src: resolved,
      fallbackAttempted: false,
      failed: false,
    });
  }

  const stateMatchesSource =
    imageState.sourceIdentity === sourceIdentity && imageState.resolved === resolved;
  const src = stateMatchesSource ? imageState.src : resolved;
  const failed = stateMatchesSource ? imageState.failed : false;

  if (!src || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-muted text-muted-foreground ${sizeClasses[size]} ${className}`}
        title={decorative ? undefined : name}
        aria-hidden={decorative || undefined}
      >
        <Bot aria-hidden className={iconSizes[size]} />
      </div>
    );
  }

  return (
    <RuntimeImage
      src={src}
      alt={decorative ? "" : name ? `${name} avatar` : "Agent avatar"}
      className={`rounded-lg object-cover ${sizeClasses[size]} ${className}`}
      loading={loading}
      decoding="async"
      onError={() => {
        if (!imageState.fallbackAttempted) {
          const fallback = uploadPreviewFallbackSrc(src);
          if (fallback && fallback !== src) {
            setImageState({
              sourceIdentity,
              resolved,
              src: fallback,
              fallbackAttempted: true,
              failed: false,
            });
            return;
          }
        }
        setImageState({
          sourceIdentity,
          resolved,
          src,
          fallbackAttempted: true,
          failed: true,
        });
      }}
    />
  );
}
