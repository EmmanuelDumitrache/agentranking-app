"use client";
import { cn } from "@/lib/utils";
export type StepHeaderInfo = {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
};
export function OnboardingStepHeader({
  step,
  total,
  title,
  subtitle,
  className,
}: StepHeaderInfo & { readonly className?: string }) {
  const progress = Math.round((step / total) * 100);
  return (
    <div className={cn("ui-onboarding-youtube__header w-full", className)}>
      <p className="text-[11px] font-medium uppercase tracking-[0.15em] text-[#aaa]">
        Create Agent{total > 1 ? ` · Step ${step} of ${total}` : ""}
      </p>
      <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-[#f1f1f1] sm:text-3xl">
        {title}
      </h1>
      {subtitle ? (
        <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-[#aaa]">
          {subtitle}
        </p>
      ) : null}
      {total > 1 ? (
        <div className="mt-5 h-px w-full overflow-hidden rounded-full bg-[#303030]">
          <div
            className="h-full rounded-full bg-[#f1f1f1] transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
