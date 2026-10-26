import type { Metadata } from "next";
import { AppRecoveryLink, AppRecoveryPage } from "@/components/layout/app-recovery-page";
/** Avoid inheriting the home `metadata.title`; clearer tabs on real 404s. */
export const metadata: Metadata = {
  title: { absolute: "Page not found | AgentRanking" },
  robots: { index: false, follow: true },
};
export default function NotFound() {
  return (
    <AppRecoveryPage
      code="404"
      title="Page not found"
      description="This page doesn't exist or may have moved. Head back to discovery or browse the directory."
      actions={
        <>
          <AppRecoveryLink href="/" primary>
            Discover
          </AppRecoveryLink>
          <AppRecoveryLink href="/agents">Agents</AppRecoveryLink>
          <AppRecoveryLink href="/tokens">Tokens</AppRecoveryLink>
        </>
      }
    />
  );
}
