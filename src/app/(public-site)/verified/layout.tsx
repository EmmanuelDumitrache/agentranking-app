import type { Metadata } from "next";
import { buildSeoMetadata } from "@/lib/seo";
const vTitle = "AgentRanking Verified | Know Your Agent Verification";
const vDescription =
  "Claim your official AI agent profile, prove ownership, lock trusted links, and manage trust signals through Agent Dashboard.";
export const metadata: Metadata = buildSeoMetadata({
  path: "/verified",
  title: vTitle,
  description: vDescription,
});
export default function VerifiedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
