"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Lock, ShieldCheck } from "lucide-react";
import type { AuthSessionMode } from "@/lib/app-auth-routes";
import { cn } from "@/lib/utils";
type Phase = "step0" | "step1" | "step2" | "done";
type Step = { id: string; label: string };
const SIGN_IN_STEPS: Step[] = [
  { id: "verify", label: "Verifying identity" },
  { id: "secure", label: "Securing session" },
  { id: "redirect", label: "Redirecting you…" },
];
const SIGN_OUT_STEPS: Step[] = [
  { id: "end", label: "Ending session" },
  { id: "clear", label: "Clearing credentials" },
  { id: "redirect", label: "Redirecting you…" },
];
const STEP_MS = 380;
const DONE_MS = 180;
type Props = {
  readonly mode: AuthSessionMode;
  readonly nextHref: string;
};
export function AuthSessionTransition({ mode, nextHref }: Props) {
  const router = useRouter();
  const steps = mode === "sign-in" ? SIGN_IN_STEPS : SIGN_OUT_STEPS;
  const [phase, setPhase] = useState<Phase>("step0");
  const phaseIdx = useMemo(() => {
    switch (phase) {
      case "step0":
        return 0;
      case "step1":
        return 1;
      case "step2":
        return 2;
      case "done":
        return 3;
      default: {
        const _exhaustive: never = phase;
        return _exhaustive;
      }
    }
  }, [phase]);
  useEffect(() => {
    const reduceMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    if (reduceMotion) {
      router.replace(nextHref);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPhase("step1"), STEP_MS));
    timers.push(setTimeout(() => setPhase("step2"), STEP_MS * 2));
    timers.push(setTimeout(() => setPhase("done"), STEP_MS * 3));
    timers.push(setTimeout(() => router.replace(nextHref), STEP_MS * 3 + DONE_MS));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [nextHref, router]);
  const title = mode === "sign-in" ? "Signing you in" : "Signed out securely";
  const subtitle =
    mode === "sign-in"
      ? "Confirming your session before opening your workspace."
      : "Your session has ended. Taking you back safely.";
  return (
    <div className="ui-auth-youtube fixed inset-0 z-40 flex overflow-hidden bg-[#0f0f0f] text-[#f1f1f1]">
      <div className="relative z-10 mx-auto flex h-full w-full max-w-md flex-col items-center justify-center px-6 py-8">
        <RuntimeImage
          src="/ar-mark.png"
          alt="AgentRanking"
          className="mb-8 h-12 w-auto max-w-[3rem] object-contain"
        />
        <div className="ui-auth-youtube__pill mb-3 inline-flex items-center gap-2 rounded-full border border-[#303030] bg-[#212121] px-3 py-1 text-xs font-medium text-[#f1f1f1]">
          <ShieldCheck className="h-3.5 w-3.5 text-[#aaa]" aria-hidden />
          {mode === "sign-in" ? "Authenticated" : "Session ended"}
        </div>
        <h1 className="text-center text-xl font-bold tracking-tight text-[#f1f1f1]">{title}</h1>
        <p className="mt-2 text-center text-sm text-[#aaa]">{subtitle}</p>
        <ul className="mt-8 w-full space-y-2">
          {steps.map((step, i) => {
            const done = i < phaseIdx;
            const active = i === phaseIdx && phase !== "done";
            return (
              <li
                key={step.id}
                className={cn(
                  "ui-auth-youtube__status flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm transition-colors",
                  active
                    ? "border-[#303030] bg-[#212121]"
                    : done
                      ? "border-[#303030] bg-[#181818] text-[#aaa]"
                      : "border-[#212121] bg-[#181818] text-[#666]",
                )}
              >
                {done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-zinc-300" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-zinc-200" />
                ) : (
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-zinc-700 text-[10px] text-zinc-500">
                    {i + 1}
                  </span>
                )}
                <span className={cn(active ? "font-medium text-zinc-50" : undefined)}>
                  {step.label}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-8 flex items-center gap-2 text-xs text-zinc-500">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Secured connection · agentranking.io</span>
        </div>
      </div>
    </div>
  );
}
