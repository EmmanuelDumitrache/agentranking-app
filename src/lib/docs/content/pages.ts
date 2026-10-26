import type { DocsContentBlock, DocsHeadingBlock, DocsPageSpec } from "@/lib/docs/types";
import { arTokenPage } from "@/lib/docs/content/pages/ar-token";
import { agentIndexPage } from "@/lib/docs/content/pages/agent-index";
import { agentsApiPage } from "@/lib/docs/content/pages/agents-api";
import { apiPage } from "@/lib/docs/content/pages/api";
import { claimingPage } from "@/lib/docs/content/pages/claiming-and-verification";
import { dashboardPage } from "@/lib/docs/content/pages/dashboard";
import { disclaimersPage } from "@/lib/docs/content/pages/disclaimers";
import { jobsPage } from "@/lib/docs/content/pages/jobs";
import { jobsApiPage } from "@/lib/docs/content/pages/jobs-api";
import { mcpPage } from "@/lib/docs/content/pages/mcp";
import { overviewPage } from "@/lib/docs/content/pages/overview";
import { partnersPage } from "@/lib/docs/content/pages/partners";
import { roadmapPage } from "@/lib/docs/content/pages/roadmap";
import { scoresReputationApiPage } from "@/lib/docs/content/pages/scores-reputation-api";
import { skillsMarketPage } from "@/lib/docs/content/pages/skills-market";
import { stakingPage } from "@/lib/docs/content/pages/staking";
import { tokenizedLaunchesPage } from "@/lib/docs/content/pages/tokenized-agent-launches";
export const DOCS_PAGE_SPECS: readonly DocsPageSpec[] = [
  overviewPage,
  agentIndexPage,
  dashboardPage,
  claimingPage,
  jobsPage,
  skillsMarketPage,
  tokenizedLaunchesPage,
  apiPage,
  mcpPage,
  agentsApiPage,
  scoresReputationApiPage,
  jobsApiPage,
  arTokenPage,
  stakingPage,
  partnersPage,
  roadmapPage,
  disclaimersPage,
];
const SPECS_BY_SLUG = new Map<string, DocsPageSpec>(
  DOCS_PAGE_SPECS.map((spec) => [spec.slug, spec]),
);
export function getDocsPageSpec(slug: string): DocsPageSpec | undefined {
  return SPECS_BY_SLUG.get(slug);
}
export function getHeadingAnchors(blocks: readonly DocsContentBlock[]): DocsHeadingBlock[] {
  const result: DocsHeadingBlock[] = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      result.push(block);
      result.push(...getHeadingAnchors(block.children));
    }
  }
  return result;
}
