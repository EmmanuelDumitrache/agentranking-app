
export type DocsPageLayout = "master";
export type DocsPage = {
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  readonly section: string;
  readonly layout?: DocsPageLayout;
};
export type DocsSection = {
  readonly id: string;
  readonly title: string;
  readonly items: readonly DocsPage[];
};
export type DocsParagraphBlock = {
  readonly type: "paragraph";
  readonly text: string;
};
export type DocsHeadingBlock = {
  readonly type: "heading";
  readonly level: 2 | 3;
  readonly title: string;
  readonly anchor: string;
  readonly children: readonly DocsContentBlock[];
};
export type DocsListBlock = {
  readonly type: "list";
  readonly ordered?: boolean;
  readonly items: readonly string[];
};
export type DocsTableBlock = {
  readonly type: "table";
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
};
export type DocsCodeBlockSpec = {
  readonly type: "code";
  readonly label: string;
  readonly content: string;
  readonly language?: "bash" | "json" | "txt" | "http";
};
export type DocsEndpointBlockSpec = {
  readonly type: "endpoint";
  readonly label: string;
  readonly value: string;
  readonly method?: string;
  readonly description?: string;
};
export type DocsCalloutBlockSpec = {
  readonly type: "callout";
  readonly variant: "info" | "warning" | "token";
  readonly title: string;
  readonly text: string;
};
export type DocsAvailabilityBlockSpec = {
  readonly type: "availability";
  readonly text: string;
};
export type DocsLinkListBlockSpec = {
  readonly type: "linkList";
  readonly items: readonly { readonly label: string; readonly href: string; readonly description?: string }[];
};
export type DocsActionsBlockSpec = {
  readonly type: "actions";
  readonly items: readonly {
    readonly label: string;
    readonly href: string;
    readonly variant?: "primary" | "outline" | "ghost";
  }[];
};
export type DocsPathCardBlockSpec = {
  readonly type: "pathCard";
  readonly title: string;
  readonly body: string;
  readonly href: string;
};
export type DocsBentoSpan = "featured" | "half" | "third" | "full";
export type DocsBentoIcon =
  | "search"
  | "layout"
  | "shield"
  | "verified"
  | "code"
  | "coins"
  | "layers"
  | "briefcase"
  | "sparkles"
  | "rocket"
  | "map"
  | "handshake"
  | "alert"
  | "terminal"
  | "database"
  | "bot"
  | "globe"
  | "zap";
export type DocsCardGridItemSpec = {
  readonly title: string;
  readonly description: string;
  readonly href?: string;
  readonly span?: DocsBentoSpan;
  readonly badge?: string;
  readonly icon?: DocsBentoIcon;
};
export type DocsCardGridBlockSpec = {
  readonly type: "cardGrid";
  readonly items: readonly DocsCardGridItemSpec[];
};
export type DocsHeroMediaBlockSpec = {
  readonly type: "heroMedia";
};
export type DocsFlywheelOverviewBlockSpec = {
  readonly type: "flywheelOverview";
};
export type DocsArTokenPanelBlockSpec = {
  readonly type: "arTokenPanel";
};
export type DocsPartnerListBlockSpec = {
  readonly type: "partnerList";
};
export type DocsRoadmapPageBlockSpec = {
  readonly type: "roadmapPage";
};
export type DocsContentBlock =
  | DocsParagraphBlock
  | DocsHeadingBlock
  | DocsListBlock
  | DocsTableBlock
  | DocsCodeBlockSpec
  | DocsEndpointBlockSpec
  | DocsCalloutBlockSpec
  | DocsAvailabilityBlockSpec
  | DocsLinkListBlockSpec
  | DocsActionsBlockSpec
  | DocsPathCardBlockSpec
  | DocsCardGridBlockSpec
  | DocsHeroMediaBlockSpec
  | DocsFlywheelOverviewBlockSpec
  | DocsArTokenPanelBlockSpec
  | DocsPartnerListBlockSpec
  | DocsRoadmapPageBlockSpec;
export type DocsPageSpec = {
  readonly slug: string;
  readonly pageTitle: string;
  readonly subtitle: string;
  readonly blocks: readonly DocsContentBlock[];
};
export type DocsTocEntry = {
  readonly title: string;
  readonly anchor: string;
};
export type DocsNavMatch = {
  readonly section: DocsSection;
  readonly page: DocsPage;
};