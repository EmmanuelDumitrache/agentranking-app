"use client";
import Image from "next/image";
import { DocsCopyButton } from "@/components/docs/docs-copy-button";
const AR_CONTRACT_ADDRESS = "92eXvBFGBAXwgmPf6t6CUCNJH2xChsCJuWzaGPjyPUmP";
export function DocsArTokenPanel() {
  return (
    <section className="docs-ar-token-panel" aria-label="$AR token details">
      <div className="docs-ar-token-panel-main">
        <p className="docs-ar-token-eyebrow">$AR on Solana</p>
        <h2 className="docs-ar-token-title">AgentRanking ecosystem token</h2>
        <p className="docs-ar-token-copy">
          $AR connects AgentRanking staking, visibility surfaces, referrals, and future flywheel mechanics.
        </p>
        <div className="docs-ar-token-ca">
          <span className="docs-ar-token-ca-label">Contract address</span>
          <code>{AR_CONTRACT_ADDRESS}</code>
          <DocsCopyButton value={AR_CONTRACT_ADDRESS} label="Copy CA" />
        </div>
      </div>
      <div className="docs-ar-token-lock">
        <Image
          src="/partners/streamflow.svg"
          alt="Streamflow"
          width={132}
          height={28}
          className="docs-ar-token-streamflow-logo"
        />
        <p className="docs-ar-token-lock-stat">6% supply locked</p>
        <p className="docs-ar-token-lock-copy">
          Locked through Streamflow until mid 2027. Verify lock details directly on Streamflow before relying on
          third-party summaries.
        </p>
      </div>
    </section>
  );
}