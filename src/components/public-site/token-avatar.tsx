"use client";
import { useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import { resolveImageUrl } from "@/lib/image-utils";
import { cn } from "@/lib/utils";
type Props = {
  readonly name: string;
  readonly symbol?: string | null;
  readonly imageUrl?: string | null;
  readonly size?: "sm" | "md";
  readonly className?: string;
};
function initials(name: string, symbol?: string | null): string {
  const fromSymbol = symbol?.replace(/^\$/, "").trim();
  if (fromSymbol && fromSymbol.length >= 2) return fromSymbol.slice(0, 2).toUpperCase();
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}
function hashHue(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.trunc((h << 5) - h + (input.codePointAt(i) ?? 0));
  }
  return Math.abs(h) % 360;
}
function AvatarImage({
  src,
  className,
  fallback,
}: {
  readonly src: string;
  readonly className: string;
  readonly fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return fallback;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
/** Compact token/agent image — never uses the marketing robot fallback. */
export function PublicTokenAvatar({ name, symbol, imageUrl, size = "md", className }: Props) {
  const dim = size === "sm" ? "size-10" : "size-14";
  const resolved = resolveImageUrl(imageUrl);
  const hue = hashHue(name);
  const fallback = (
    <div
      className={cn(
        dim,
        "flex shrink-0 items-center justify-center rounded-lg border border-border/60 font-semibold tabular-nums",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 42% 18%) 0%, hsl(${(hue + 40) % 360} 38% 12%) 100%)`,
        color: `hsl(${hue} 55% 72%)`,
        fontSize: size === "sm" ? "11px" : "13px",
      }}
      aria-hidden
    >
      {initials(name, symbol)}
    </div>
  );
  if (!resolved) return fallback;
  return (
    <AvatarImage
      key={resolved}
      src={resolved}
      className={cn(dim, "shrink-0 rounded-lg border border-border/60 object-cover", className)}
      fallback={fallback}
    />
  );
}
export function PublicAgentAvatar({
  name,
  imageUrl,
  size = "md",
  className,
}: Omit<Props, "symbol">) {
  const dim = size === "sm" ? "size-10" : "size-14";
  const resolved = resolveImageUrl(imageUrl);
  const fallback = (
    <div
      className={cn(
        dim,
        "bg-muted text-muted-foreground flex shrink-0 items-center justify-center rounded-lg border border-border/60",
        className,
      )}
      title={name}
      aria-hidden
    >
      <Bot className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </div>
  );
  if (!resolved) return fallback;
  return (
    <AvatarImage
      key={resolved}
      src={resolved}
      className={cn(dim, "shrink-0 rounded-lg border border-border/60 object-cover", className)}
      fallback={fallback}
    />
  );
}
