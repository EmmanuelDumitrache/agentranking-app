import { Bot, Coins, TrendingUp } from "lucide-react";
import { PublicSiteSection } from "@/components/public-site/public-site-section";
const STEPS = [
  { icon: Bot, title: "Create", body: "Identity, wallet, and profile." },
  { icon: Coins, title: "Launch", body: "Linked Pump.fun token." },
  { icon: TrendingUp, title: "Rank", body: "Score, verification, and visibility." },
] as const;
export function HowItWorksSection() {
  return (
    <PublicSiteSection
      id="how-it-works"
      eyebrow="How it works"
      title="From identity to market"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <article key={step.title} className="ui-panel ui-panel--stack">
            <span className="text-muted-foreground text-[10px] font-semibold tabular-nums">{index + 1}</span>
            <step.icon className="h-5 w-5 text-foreground/50" aria-hidden />
            <h3 className="text-sm font-semibold">{step.title}</h3>
            <p className="text-muted-foreground text-sm">{step.body}</p>
          </article>
        ))}
      </div>
    </PublicSiteSection>
  );
}
