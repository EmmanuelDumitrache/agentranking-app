"use client";

import { useState } from "react";
import { Lock, ShieldCheck, Snowflake, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArCardPinInput, isPinComplete } from "@/components/treasury/ar-card-pin-input";
import { cn } from "@/lib/utils";

export type ArCardPinDialogMode = "set" | "remove" | "freeze" | "unfreeze";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ArCardPinDialogMode;
  cardLabel?: string;
  busy?: boolean;
  error?: string | null;
  onSubmit: (pin: string, confirmPin?: string) => Promise<void> | void;
};

function modeCopy(mode: ArCardPinDialogMode, step: "enter" | "confirm") {
  switch (mode) {
    case "set":
      return step === "enter"
        ? {
            title: "Set freeze PIN",
            description: "Choose a 4-digit PIN. You’ll need it to freeze or unfreeze this card.",
            icon: ShieldCheck,
            submit: "Continue",
          }
        : {
            title: "Confirm freeze PIN",
            description: "Enter the same PIN again to confirm.",
            icon: ShieldCheck,
            submit: "Set PIN",
          };
    case "remove":
      return {
        title: "Remove freeze PIN",
        description: "Enter your current PIN to remove freeze protection from this card.",
        icon: Trash2,
        submit: "Remove PIN",
      };
    case "freeze":
      return {
        title: "Freeze card",
        description: "Enter your 4-digit freeze PIN to lock this card.",
        icon: Snowflake,
        submit: "Freeze card",
      };
    case "unfreeze":
      return {
        title: "Unfreeze card",
        description: "Enter your 4-digit freeze PIN to unlock this card.",
        icon: Lock,
        submit: "Unfreeze card",
      };
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function ArCardPinDialog({
  open,
  onOpenChange,
  mode,
  cardLabel,
  busy = false,
  error,
  onSubmit,
}: Props) {
  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [previousOpen, setPreviousOpen] = useState(open);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (!open) {
      setStep("enter");
      setPin("");
      setConfirmPin("");
    }
  }

  const copy = modeCopy(mode, step);
  const Icon = copy.icon;
  const activePin = step === "confirm" ? confirmPin : pin;
  const canSubmit = isPinComplete(activePin) && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    if (mode === "set" && step === "enter") {
      setStep("confirm");
      setConfirmPin("");
      return;
    }
    await onSubmit(pin, mode === "set" ? confirmPin : undefined);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden border bg-background p-0">
        <div className="border-b bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.06)_0%,transparent_55%)] px-6 py-5">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl border bg-muted/40 ring-1 ring-white/10">
                <Icon className="size-4 text-foreground" aria-hidden />
              </div>
              <div>
                <DialogTitle>{copy.title}</DialogTitle>
                {cardLabel ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">{cardLabel}</p>
                ) : null}
              </div>
            </div>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          <ArCardPinInput
            value={activePin}
            onChange={step === "confirm" ? setConfirmPin : setPin}
            disabled={busy}
            autoFocus={open}
            error={Boolean(error)}
          />
          {error ? (
            <p className="text-center text-sm text-destructive">{error}</p>
          ) : (
            <p className="text-center text-xs text-muted-foreground">
              {step === "confirm" ? "Re-enter your PIN to confirm." : "4 digits · numbers only"}
            </p>
          )}
        </div>

        <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:justify-between">
          {mode === "set" && step === "confirm" ? (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setStep("enter");
                setConfirmPin("");
              }}
            >
              Back
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
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
              disabled={!canSubmit}
              className={cn(busy && "opacity-80")}
              onClick={() => void handleSubmit()}
            >
              {busy ? "Working…" : copy.submit}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
