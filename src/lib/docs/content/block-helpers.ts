import type {
  DocsCardGridItemSpec,
  DocsContentBlock,
  DocsHeadingBlock,
  DocsListBlock,
  DocsTableBlock,
} from "@/lib/docs/types";
export function h2(title: string, anchor: string, children: readonly DocsContentBlock[]): DocsHeadingBlock {
  return { type: "heading", level: 2, title, anchor, children };
}
export function h3(title: string, anchor: string, children: readonly DocsContentBlock[]): DocsHeadingBlock {
  return { type: "heading", level: 3, title, anchor, children };
}
export function p(text: string): DocsContentBlock {
  return { type: "paragraph", text };
}
export function ul(items: readonly string[], ordered = false): DocsListBlock {
  return { type: "list", ordered, items };
}
export function ol(items: readonly string[]): DocsListBlock {
  return { type: "list", ordered: true, items };
}
export function table(headers: readonly string[], rows: readonly (readonly string[])[]): DocsTableBlock {
  return { type: "table", headers, rows };
}
export function code(label: string, content: string, language: "bash" | "json" | "txt" | "http" = "bash"): DocsContentBlock {
  return { type: "code", label, content, language };
}
export function endpoint(label: string, value: string, method?: string, description?: string): DocsContentBlock {
  return { type: "endpoint", label, value, method, description };
}
export function callout(
  variant: "info" | "warning" | "token",
  title: string,
  text: string,
): DocsContentBlock {
  return { type: "callout", variant, title, text };
}
export function availability(text: string): DocsContentBlock {
  return { type: "availability", text };
}
export function linkList(
  items: readonly { readonly label: string; readonly href: string; readonly description?: string }[],
): DocsContentBlock {
  return { type: "linkList", items };
}
export function actions(
  items: readonly { readonly label: string; readonly href: string; readonly variant?: "primary" | "outline" | "ghost" }[],
): DocsContentBlock {
  return { type: "actions", items };
}
export function pathCard(title: string, body: string, href: string): DocsContentBlock {
  return { type: "pathCard", title, body, href };
}
export function cardGrid(items: readonly DocsCardGridItemSpec[]): DocsContentBlock {
  return { type: "cardGrid", items };
}
export function heroMedia(): DocsContentBlock {
  return { type: "heroMedia" };
}
export function flywheelOverview(): DocsContentBlock {
  return { type: "flywheelOverview" };
}
export function arTokenPanel(): DocsContentBlock {
  return { type: "arTokenPanel" };
}
export function partnerList(): DocsContentBlock {
  return { type: "partnerList" };
}
export function roadmapPage(): DocsContentBlock {
  return { type: "roadmapPage" };
}