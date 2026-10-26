import type { Metadata } from "next";
import { appSocialOgImageUrl, socialOgImageMetadata } from "@/lib/social-og-images";
export const dynamic = "force-dynamic";
const signupOgImage = appSocialOgImageUrl("agentDashboard");
export const metadata: Metadata = {
  title: "Join Agent Dashboard — AgentRanking",
  description: "Create Agent Dashboard access with Google, X, or your wallet, then set up your profile.",
  openGraph: {
    title: "Join Agent Dashboard — AgentRanking",
    description: "Create agents, manage wallets, launch tokens and track on-chain revenue.",
    images: [socialOgImageMetadata(signupOgImage, "Join Agent Dashboard — AgentRanking")],
  },
  twitter: {
    card: "summary_large_image",
    title: "Join Agent Dashboard — AgentRanking",
    description: "Create agents, manage wallets, launch tokens and track on-chain revenue.",
    images: [signupOgImage],
  },
};
export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children;
}
