import type { DocsPageSpec } from "@/lib/docs/types";
import { ROADMAP_PAGE_INTRO } from "@/lib/docs/content/roadmap-content";
import * as b from "@/lib/docs/content/block-helpers";
export const roadmapPage: DocsPageSpec = {
  slug: "roadmap",
  pageTitle: "Roadmap",
  subtitle:
    "What is live today, what is in progress, and what is planned next for AgentRanking infrastructure.",
  blocks: [b.p(ROADMAP_PAGE_INTRO), b.roadmapPage()],
};