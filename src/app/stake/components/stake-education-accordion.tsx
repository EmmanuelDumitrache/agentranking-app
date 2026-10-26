"use client";
import { FAQGrid } from "@/app/stake/primitives";
import { InfoAccordion } from "@/app/stake/shell/info-accordion";
import { StakeSiteSection } from "@/app/stake/shell/stake-site-section";
import { STAKE_FAQ_ITEMS } from "@/lib/stake-page-data";
import {
  STAKE_FAQ_SECTION,
  STAKE_REWARD_MODEL,
  STAKING_HOW_IT_WORKS,
} from "@/lib/staking-config";
import { STAKING_DASHBOARD_AMOUNT } from "@/lib/staking-dashboard-copy";
import { StakingDiagrams } from "./staking-diagrams";
export function StakeEducationAccordion() {
  return (
    <StakeSiteSection
      id="education"
      eyebrow="LEARN"
      title="How staking works"
      compact
      subtle
      className="scroll-mt-24"
    >
      <div id="flywheel">
        <InfoAccordion
          className="ar-public-glass rounded-xl px-4 sm:px-5"
          items={[
            {
              id: "how",
              title: "How staking works",
              defaultOpen: true,
              content: (
                <div className="space-y-3 text-[13px] leading-[1.55] text-[var(--ar-text-secondary)]">
                  <p>{STAKING_HOW_IT_WORKS.subtitle}</p>
                  <ol className="list-decimal space-y-2 pl-4">
                    {STAKING_HOW_IT_WORKS.steps.map((step) => (
                      <li key={step.title}>
                        <strong className="text-[var(--ar-text-primary)]">{step.title}</strong> —{" "}
                        {step.copy}
                      </li>
                    ))}
                  </ol>
                  <p className="text-[var(--ar-text-tertiary)]">{STAKING_HOW_IT_WORKS.footnote}</p>
                </div>
              ),
            },
            {
              id: "flywheel",
              title: STAKE_REWARD_MODEL.title,
              content: (
                <div className="space-y-3 text-[13px] leading-[1.55] text-[var(--ar-text-secondary)]">
                  <p>{STAKE_REWARD_MODEL.subtitle}</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {STAKE_REWARD_MODEL.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ul>
                  <p className="text-[var(--ar-text-tertiary)]">{STAKE_REWARD_MODEL.disclaimer}</p>
                  <StakingDiagrams />
                </div>
              ),
            },
            {
              id: "receipt",
              title: "Receipt token warning",
              content: (
                <p className="text-[13px] leading-[1.55] text-[var(--ar-text-secondary)]">
                  {STAKING_DASHBOARD_AMOUNT.helper} Staking is non-custodial through Streamflow.
                  AgentRanking cannot manually move your locked tokens.
                </p>
              ),
            },
            {
              id: "faq",
              title: STAKE_FAQ_SECTION.title,
              content: <FAQGrid items={STAKE_FAQ_ITEMS} />,
            },
          ]}
        />
      </div>
    </StakeSiteSection>
  );
}
