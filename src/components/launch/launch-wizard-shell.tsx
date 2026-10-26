"use client";
import { CheckCircle } from "lucide-react";
import { LAUNCH_STEPS, type LaunchStepId } from "@/lib/launch/constants";
import { cn } from "@/lib/utils";
export function LaunchWizardStepper({
  step,
  onStepClick,
  canReach,
}: {
  readonly step: LaunchStepId;
  readonly onStepClick: (target: LaunchStepId) => void;
  readonly canReach: (target: LaunchStepId) => boolean;
}) {
  return (
    <div className="launch-wizard-stepper" aria-label="Create progress">
      {LAUNCH_STEPS.map((item, index) => {
        const done = step > item.id;
        const active = step === item.id;
        const reachable = canReach(item.id);
        return (
          <div key={item.id} className="launch-wizard-stepper-item">
            {index > 0 ? (
              <div
                className={cn(
                  "launch-wizard-stepper-line",
                  done || active ? "launch-wizard-stepper-line--active" : undefined,
                )}
                aria-hidden
              />
            ) : null}
            <button
              type="button"
              disabled={!reachable && !active}
              onClick={() => {
                if (reachable || active) onStepClick(item.id);
              }}
              className={cn(
                "launch-wizard-stepper-node",
                active && "launch-wizard-stepper-node--active",
                done && "launch-wizard-stepper-node--done",
              )}
            >
              {done ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : item.id}
            </button>
            <span
              className={cn(
                "launch-wizard-stepper-label",
                (active || done) && "launch-wizard-stepper-label--active",
              )}
            >
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
export function LaunchWizardPanel({
  title,
  description,
  children,
  footer,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: React.ReactNode;
  readonly footer?: React.ReactNode;
}) {
  return (
    <section className="launch-wizard-panel">
      <header className="launch-wizard-panel-header">
        <h2 className="launch-wizard-panel-title">{title}</h2>
        {description ? <p className="launch-wizard-panel-desc">{description}</p> : null}
      </header>
      <div className="launch-wizard-panel-body">{children}</div>
      {footer ? <footer className="launch-wizard-panel-footer">{footer}</footer> : null}
    </section>
  );
}
export function LaunchWizardNav({
  onBack,
  backLabel = "Back",
  onNext,
  nextLabel,
  nextDisabled,
}: {
  readonly onBack?: () => void;
  readonly backLabel?: string;
  readonly onNext?: () => void;
  readonly nextLabel: string;
  readonly nextDisabled?: boolean;
}) {
  return (
    <div className="launch-wizard-nav">
      {onBack ? (
        <button type="button" className="ar-btn ar-btn-secondary" onClick={onBack}>
          {backLabel}
        </button>
      ) : (
        <span />
      )}
      {onNext ? (
        <button
          type="button"
          className="ar-btn ar-btn-primary"
          disabled={nextDisabled}
          onClick={onNext}
        >
          {nextLabel}
        </button>
      ) : null}
    </div>
  );
}