"use client";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast-simple";
import { Link2 } from "lucide-react";
export function SapShareUrlButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 w-full gap-1 border-emerald-500/35 px-3 text-xs text-emerald-200 hover:bg-emerald-500/10 sm:h-9 sm:w-auto sm:gap-1.5 sm:text-sm"
      onClick={() => {
        const url = typeof window !== "undefined" ? window.location.href : "";
        if (!url) return;
        void navigator.clipboard.writeText(url).then(() => showToast("Link copied"));
      }}
    >
      <Link2 className="h-3.5 w-3.5" />
      Share
    </Button>
  );
}