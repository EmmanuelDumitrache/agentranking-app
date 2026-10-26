"use client";
import { cn } from "@/lib/utils";
/** Ethereum icon as inline SVG — 14x14, responds to text color via currentColor */
export function EthereumIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn("shrink-0 text-foreground", className)}
      width="14"
      height="14"
      viewBox="0 0 256 417"
      fill="none"
      aria-hidden
    >
      <path
        d="M127.961 0l-2.795 9.5v275.668l2.795 2.79 127.962-75.638-127.962-60.698z"
        fill="currentColor"
        fillOpacity="0.78"
      />
      <path
        d="M127.962 0L0 212.32l127.962 75.639V154.158l-2.795-13.691z"
        fill="currentColor"
        fillOpacity="0.52"
      />
      <path
        d="M127.961 312.187l-1.575 1.92v98.199l1.575 4.6L256 236.587l-128.039 75.6z"
        fill="currentColor"
        fillOpacity="0.76"
      />
      <path
        d="M127.962 416.905v-104.72L0 236.585l127.962 75.6v104.72z"
        fill="currentColor"
        fillOpacity="0.52"
      />
      <path
        d="M127.961 287.958l127.96-75.637-127.96-58.162-2.795-15.062v148.861z"
        fill="currentColor"
        fillOpacity="0.92"
      />
      <path
        d="M0 212.32l127.96 75.638V154.158l-2.795-15.062-127.96 58.172z"
        fill="currentColor"
        fillOpacity="0.82"
      />
    </svg>
  );
}