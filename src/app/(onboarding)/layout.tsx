import type { Metadata } from "next";
import { OnboardingWaveBackground } from "@/components/dashboard/onboarding-wave-background";

export const metadata: Metadata = {
  title: "Create Agent — AgentRanking",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function OnboardingRootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div className="ui-onboarding-youtube relative flex min-h-screen flex-col overflow-hidden bg-[#0f0f0f] text-[#f1f1f1]">
      <OnboardingWaveBackground />
      <div className="relative z-10 flex min-h-screen flex-col">{children}</div>
    </div>
  );
}
