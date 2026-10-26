import type { Metadata } from "next";
import { CreatePageClient } from "@/components/launch/launch-page-client";
import { readCreateAgentPageConfig } from "@/lib/public-launch/create-agent-config.server";

export const metadata: Metadata = {
  title: "Create an on-chain agent — AgentRanking",
  description: "Register an ERC-8004 agent across supported networks.",
};

export default function CreatePage() {
  const config = readCreateAgentPageConfig();
  return <CreatePageClient config={config} />;
}
