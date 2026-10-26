"use client";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import Image from "next/image";
interface ChainBadgeProps {
  name: string;
  color: string;
  icon?: string;
  size?: "sm" | "md";
  iconOnly?: boolean;
  className?: string;
}
export function ChainBadge({
  name,
  color,
  icon,
  size = "sm",
  iconOnly = false,
  className,
}: ChainBadgeProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const onImageError = useCallback(() => setImageFailed(true), []);
  const isImageIcon =
    Boolean(icon) && !imageFailed && (icon!.startsWith("http") || icon!.startsWith("/"));
  const imgSize = size === "sm" ? 14 : 18;
  const letter = name.slice(0, 1);
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full shrink-0",
        iconOnly
          ? size === "sm"
            ? "h-5 w-5"
            : "h-6 w-6"
          : cn(
              "gap-1 font-medium leading-none",
              size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
            ),
        className,
      )}
      style={{ backgroundColor: color + "20", color }}
      title={iconOnly ? name : undefined}
    >
      {icon && isImageIcon ? (
        <Image
          src={icon}
          alt={name}
          width={iconOnly ? (size === "sm" ? 12 : 16) : imgSize}
          height={iconOnly ? (size === "sm" ? 12 : 16) : imgSize}
          className="rounded-full object-cover"
          unoptimized
          onError={onImageError}
        />
      ) : (
        <span className="text-[10px] font-medium">{letter}</span>
      )}
      {!iconOnly && name}
    </span>
  );
}