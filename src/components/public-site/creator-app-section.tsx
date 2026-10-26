import {
  Activity,
  BadgeCheck,
  BarChart3,
  KeyRound,
  Link2,
  Rocket,
  Wallet,
} from "lucide-react";
import { GithubLogo } from "@/components/shared/brand-icons";
import { PublicSiteSection } from "@/components/public-site/public-site-section";
const FEATURES = [
  { icon: Wallet, label: "Agent Wallets" },
  { icon: Rocket, label: "Launch Token" },
  { icon: BadgeCheck, label: "Verification" },
  { icon: GithubLogo, label: "GitHub / DevProof" },
  { icon: KeyRound, label: "API Keys / Services" },
  { icon: Activity, label: "Health" },
  { icon: BarChart3, label: "Analytics" },
  { icon: Link2, label: "Social Links" },
] as const;
export function CreatorAppSection() {
  return (
    <PublicSiteSection
      eyebrow="Agent Dashboard"
      title="Your agent command center"
      description="Create agents, manage wallets, launch tokens, connect GitHub, track health, and monitor analytics from one dashboard. Agent creation is free; agents keep 70% of creator fees."
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8">
        {FEATURES.map((feature) => (
          <div
            key={feature.label}
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-[var(--app-inset)] px-3 py-2.5"
          >
            <feature.icon className="ui-public-site-accent h-4 w-4 shrink-0" aria-hidden />
            <span className="text-xs font-medium">{feature.label}</span>
          </div>
        ))}
      </div>
    </PublicSiteSection>
  );
}
