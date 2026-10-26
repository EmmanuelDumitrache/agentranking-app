"use client";
import { useCallback, useMemo, useState } from "react";
import {
  robinhoodTokenImageCandidates,
  robinhoodTokenInitials,
  type RobinhoodImageSource,
} from "@/lib/robinhood-chain/resolve-token-image";
import { cn } from "@/lib/utils";
type Props = {
  source: RobinhoodImageSource;
  alt: string;
  className?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
};
/**
 * Prefer plain <img> over next/image so IPFS/Blob/agent URLs work without
 * remotePatterns churn, and onError can advance the fallback chain.
 */
export function RobinhoodTokenImage({
  source,
  alt,
  className,
  fill,
  width,
  height,
}: Props) {
  const ordered = useMemo(() => robinhoodTokenImageCandidates(source), [source]);
  const orderedKey = ordered.join("|");
  const [failureState, setFailureState] = useState({ orderedKey, index: 0 });
  const index = failureState.orderedKey === orderedKey ? failureState.index : 0;
  const src = ordered[index] ?? null;
  const initials = robinhoodTokenInitials(source);
  const onError = useCallback(() => {
    setFailureState((current) => {
      const currentIndex = current.orderedKey === orderedKey ? current.index : 0;
      return {
        orderedKey,
        index: currentIndex + 1 < ordered.length ? currentIndex + 1 : ordered.length,
      };
    });
  }, [ordered.length, orderedKey]);
  if (!src) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted/40 text-xs font-semibold uppercase text-muted-foreground",
          fill && "absolute inset-0 h-full w-full",
          className,
        )}
        style={!fill && width && height ? { width, height } : undefined}
        aria-label={alt}
      >
        {initials}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote IPFS/Blob URLs; fallback chain via onError
    <img
      src={src}
      alt={alt}
      width={fill ? undefined : width ?? 64}
      height={fill ? undefined : height ?? 64}
      className={cn(fill && "absolute inset-0 h-full w-full object-cover", className)}
      onError={onError}
    />
  );
}
