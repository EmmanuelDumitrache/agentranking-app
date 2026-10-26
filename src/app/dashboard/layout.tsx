import type { Metadata } from "next";
import { appSocialOgImageUrl, socialOgImageMetadata } from "@/lib/social-og-images";

const dashboardOgImage = appSocialOgImageUrl("agentDashboard");

export const metadata: Metadata = {
  title: "Dashboard | AgentRanking",
  description: "Create agents, manage wallets, launch tokens and track on-chain revenue.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Agent Dashboard | AgentRanking",
    description: "Create agents, manage wallets, launch tokens and track on-chain revenue.",
    images: [socialOgImageMetadata(dashboardOgImage, "Agent Dashboard | AgentRanking")],
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Dashboard | AgentRanking",
    description: "Create agents, manage wallets, launch tokens and track on-chain revenue.",
    images: [dashboardOgImage],
  },
};

export default function DashboardLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return children;
}
