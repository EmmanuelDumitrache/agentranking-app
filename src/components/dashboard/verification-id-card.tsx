"use client";

import { useMemo, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Copy } from "lucide-react";
import QRCode from "react-qr-code";
import { RuntimeImage } from "@/components/shared/runtime-image";
import { showToast } from "@/components/ui/toast-simple";
import { cn } from "@/lib/utils";
import { credentialProofUrl } from "@/lib/verification/public-agent-credential";
import type { AccountVerificationLevel } from "@/generated/prisma/client";

type Props = {
  readonly publicId: string;
  readonly level: AccountVerificationLevel;
  readonly verifiedAt: Date | null;
};

function levelLabel(level: AccountVerificationLevel): string {
  switch (level) {
    case "BUSINESS":
      return "BUSINESS";
    case "INDIVIDUAL":
      return "INDIVIDUAL";
    case "NONE":
      return "UNVERIFIED";
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

function tierLabel(level: AccountVerificationLevel): string {
  switch (level) {
    case "BUSINESS":
      return "TIER 3";
    case "INDIVIDUAL":
      return "TIER 2";
    case "NONE":
      return "TIER 1";
    default: {
      const _exhaustive: never = level;
      return _exhaustive;
    }
  }
}

export function VerificationIdCard({ publicId, level, verifiedAt }: Props) {
  const reduceMotion = useReducedMotion();
  const [flipped, setFlipped] = useState(false);
  const proofUrl = useMemo(() => credentialProofUrl(publicId), [publicId]);
  const year = verifiedAt?.getFullYear() ?? new Date().getFullYear();

  async function copyPublicId() {
    try {
      await navigator.clipboard.writeText(publicId);
      showToast("Credential ID copied");
    } catch {
      showToast("Could not copy credential ID", "error");
    }
  }

  return (
    <div className="ui-verification-id-wrap">
      <div
        className={cn(
          "ui-verification-id-stage",
          !reduceMotion && !flipped && "ui-verification-id-stage--rock",
        )}
      >
        <button
          type="button"
          className={cn("ui-verification-id-flip", flipped && "is-flipped")}
          onClick={() => setFlipped((value) => !value)}
          aria-pressed={flipped}
          aria-label={
            flipped
              ? "Show front of AgentRanking identity card"
              : "Show back of AgentRanking identity card"
          }
        >
          <div className="ui-verification-id-body">
            <div className="ui-verification-id-face ui-verification-id-face--front">
              <div className="ui-verification-id-hologram" aria-hidden />
              <div className="ui-verification-id-front-top">
                <RuntimeImage
                  src="/brand/ar-mark-white.png"
                  alt=""
                  className="ui-verification-id-mark"
                />
                <span>AGENTRANKING</span>
              </div>
              <div className="ui-verification-id-tick" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" className="h-10 w-10">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.4" />
                  <path
                    d="M8.2 12.3 10.7 14.8 15.8 9.4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div className="ui-verification-id-front-copy">
                <p className="ui-verification-id-kicker">Verified identity · {tierLabel(level)}</p>
                <p className="ui-verification-id-title">AgentRanking ID</p>
              </div>
              <div className="ui-verification-id-front-meta">
                <span>{levelLabel(level)}</span>
                <span>{year}</span>
              </div>
            </div>
            <div className="ui-verification-id-face ui-verification-id-face--back">
              <div className="ui-verification-id-hologram" aria-hidden />
              <p className="ui-verification-id-back-kicker">Public credential</p>
              <div className="ui-verification-id-qr">
                <QRCode
                  value={proofUrl}
                  size={108}
                  bgColor="#0f0f0f"
                  fgColor="#f1f1f1"
                  level="M"
                />
              </div>
              <p className="ui-verification-id-code">{publicId}</p>
              <p className="ui-verification-id-fine">
                Local identity card · no PII · not minted
              </p>
            </div>
          </div>
        </button>
      </div>
      <div className="ui-verification-id-actions">
        <p className="ui-verification-id-hint">
          {flipped ? "Click the card to flip back" : "Click the card to reveal your code"}
        </p>
        <button
          type="button"
          className="ui-verification-id-copy"
          onClick={() => void copyPublicId()}
        >
          <Copy className="h-3.5 w-3.5" aria-hidden />
          Copy ID
        </button>
      </div>
    </div>
  );
}
