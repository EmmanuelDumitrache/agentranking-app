"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const CARD_TERMS_SECTIONS = [
  {
    title: "Infrastructure only",
    body:
      "AgentRanking provides access to existing prepaid virtual card infrastructure for agentic and account use. We are not the card issuer, bank, or payment network.",
  },
  {
    title: "Issued via Kripi",
    body:
      "AR virtual cards are issued through Kripi (Kripicard) and its banking partners. By proceeding, you understand your card relationship is with that issuer program, subject to their rules, limits, and enforcement.",
  },
  {
    title: "Issuer & program risk",
    body:
      "Programs may change, pause, or terminate without notice. Funds may be subject to review, hold, seizure, liquidation, chargeback recovery, or clawback by the issuer, sponsor bank, or authorities. You assume these risks.",
  },
  {
    title: "Your details & card security",
    body:
      "Card credentials, identity information, and account access are your responsibility. AgentRanking recommends freezing or deleting unused cards, rotating credentials when compromised, and never sharing PAN/CVV.",
  },
  {
    title: "Agentic use & third-party AI",
    body:
      "Agents on AgentRanking may invoke third-party LLMs and tools. Hallucinations, misreads, wrong amounts, or unauthorized actions initiated by an agent are your full responsibility. Review agent permissions and spending limits before enabling card use.",
  },
  {
    title: "Merchant acceptance",
    body:
      "We do not guarantee any merchant, platform, or country will accept your card. BIN, region, MCC, and issuer risk controls vary. Start with a small test amount with any merchant you care about before loading meaningful balance.",
  },
  {
    title: "Lawful use & enforcement",
    body:
      "Illicit, fraudulent, or illegal purchases may trigger audits by the card issuer, payment networks, and law enforcement. AgentRanking may suspend or permanently ban accounts that violate law, issuer policy, or our terms.",
  },
  {
    title: "No advice or warranty",
    body:
      "Card features, fees, and availability are presented for convenience only and may change. AgentRanking disclaims warranties and is not liable for issuer outages, declines, lost funds, or indirect damages to the maximum extent permitted by law.",
  },
  {
    title: "Your acceptance",
    body:
      "By confirming below, you agree you have read these terms, understand the risks of virtual prepaid cards in agentic workflows, and accept full responsibility for how your account and agents use issued cards.",
  },
] as const;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accepted: boolean;
  onAccept: () => void;
};

export function ArCardTermsDialog({ open, onOpenChange, accepted, onAccept }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [previousOpen, setPreviousOpen] = useState(open);

  if (previousOpen !== open) {
    setPreviousOpen(open);
    if (open) setScrolledToEnd(false);
  }

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
    setScrolledToEnd(atEnd);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(checkScroll);
    return () => window.cancelAnimationFrame(frame);
  }, [checkScroll, open]);

  const handleAccept = () => {
    onAccept();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(88vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-6 py-4 text-left">
          <DialogTitle>AR card terms & conditions</DialogTitle>
          <DialogDescription>
            Read all sections before issuing a card. Scroll to the bottom to confirm.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="min-h-0 flex-1 overflow-y-auto px-6 py-4"
        >
          <ol className="space-y-4">
            {CARD_TERMS_SECTIONS.map((section, index) => (
              <li key={section.title} className="space-y-1.5">
                <p className="text-sm font-semibold tracking-tight">
                  {index + 1}. {section.title}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">{section.body}</p>
              </li>
            ))}
          </ol>
        </div>

        <DialogFooter className="flex-col gap-3 border-t bg-muted/20 px-6 py-4 sm:flex-col sm:items-stretch">
          {!scrolledToEnd ? (
            <p className="text-center text-[11px] text-muted-foreground">
              Scroll to the bottom to enable confirmation.
            </p>
          ) : null}
          <Button
            type="button"
            className="w-full"
            disabled={!scrolledToEnd}
            onClick={handleAccept}
          >
            I confirm I have read and accept all terms
          </Button>
          {accepted ? (
            <p className="text-center text-[11px] text-muted-foreground">
              Terms accepted for this session.
            </p>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type CreateActionsProps = {
  busy: boolean;
  canSubmit: boolean;
  termsAccepted: boolean;
  demoFlow: boolean;
  onOpenTerms: () => void;
  onCreate: () => void;
};

export function ArCardCreateActions({
  busy,
  canSubmit,
  termsAccepted,
  demoFlow,
  onOpenTerms,
  onCreate,
}: CreateActionsProps) {
  const ready = canSubmit && termsAccepted;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onOpenTerms}
        >
          Terms &amp; conditions
        </Button>
        <Button
          type="button"
          className={cn("flex-1", ready && "shadow-sm")}
          disabled={busy || !ready}
          onClick={onCreate}
        >
          {busy ? "Creating…" : demoFlow ? "Create demo card" : "Create card"}
        </Button>
      </div>
      {!termsAccepted ? (
        <p className="text-center text-[11px] text-muted-foreground">
          Review and accept terms before creating a card.
        </p>
      ) : null}
    </div>
  );
}
