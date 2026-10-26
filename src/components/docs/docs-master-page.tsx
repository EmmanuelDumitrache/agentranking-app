import type { ReactNode } from "react";
import Link from "next/link";
import { DocsAvailability } from "@/components/docs/docs-availability";
import { DocsArTokenPanel } from "@/components/docs/docs-ar-token-panel";
import { DocsCallout } from "@/components/docs/docs-callout";
import { DocsCodeBlock } from "@/components/docs/docs-code-block";
import { DocsBentoGrid } from "@/components/docs/docs-bento-grid";
import { DocsFlywheelOverview } from "@/components/docs/docs-flywheel-overview";
import { DocsHeroMedia } from "@/components/docs/docs-hero-media";
import { DocsPartnersGrid } from "@/components/docs/docs-partners-grid";
import { DocsRoadmapPage } from "@/components/docs/docs-roadmap-page";
import { DocsEndpointCard } from "@/components/docs/docs-endpoint-card";
import { DocsPageHeader } from "@/components/docs/docs-page-header";
import {
  docsH2Class,
  docsH3Class,
  docsListClass,
  docsParagraphClass,
  docsSurfaceClass,
} from "@/components/docs/docs-ui";
import { getDocsPageSpec } from "@/lib/docs/content/pages";
import { getDocsPageTitle, getDocsPageSubtitle } from "@/lib/docs/navigation";
import type { DocsContentBlock, DocsPage } from "@/lib/docs/types";
import { cn } from "@/lib/utils";
function renderBlock(block: DocsContentBlock, key: string): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <p key={key} className={docsParagraphClass}>
          {block.text}
        </p>
      );
    case "heading": {
      const Tag = block.level === 2 ? "h2" : "h3";
      const className = block.level === 2 ? docsH2Class : docsH3Class;
      return (
        <section key={key} aria-labelledby={block.anchor} className="space-y-3">
          <Tag id={block.anchor} className={className}>
            {block.title}
          </Tag>
          <div className="space-y-3">{block.children.map((child, i) => renderBlock(child, `${key}-${i}`))}</div>
        </section>
      );
    }
    case "list":
      if (block.ordered) {
        return (
          <ol key={key} className={cn(docsListClass, "list-decimal space-y-2 pl-5")}>
            {block.items.map((item) => (
              <li key={item.slice(0, 40)}>{item}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul key={key} className="docs-list">
          {block.items.map((item) => (
            <li key={item.slice(0, 40)} className="docs-list-item">
              <span className="docs-list-bullet" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div key={key} className="docs-table-wrap">
          <table className="docs-table">
            <thead>
              <tr>
                {block.headers.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={cn(ci === 0 && block.headers.length === 2 ? "font-mono docs-micro" : undefined)}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return (
        <DocsCodeBlock
          key={key}
          label={block.label}
          code={block.content}
          language={block.language === "txt" ? undefined : block.language}
        />
      );
    case "endpoint":
      return (
        <DocsEndpointCard
          key={key}
          label={block.label}
          value={block.value}
          method={block.method}
          description={block.description}
        />
      );
    case "callout":
      return (
        <DocsCallout key={key} type={block.variant === "token" ? "token" : block.variant} title={block.title}>
          {block.text}
        </DocsCallout>
      );
    case "availability":
      return <DocsAvailability key={key}>{block.text}</DocsAvailability>;
    case "linkList":
      return (
        <ul key={key} className="docs-list">
          {block.items.map((item) => (
            <li key={item.href} className="docs-list-item">
              <span className="docs-list-bullet" aria-hidden />
              <div>
                <Link href={item.href} className="docs-link">
                  {item.label}
                </Link>
                {item.description ? <p className="docs-small mt-0.5">{item.description}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      );
    case "actions":
      return (
        <div key={key} className="docs-actions">
          {block.items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={item.variant === "primary" ? "docs-button-primary" : "docs-button"}
            >
              {item.label}
            </Link>
          ))}
        </div>
      );
    case "pathCard":
      return (
        <div key={key} className={cn(docsSurfaceClass)}>
          <p className="docs-card-title">{block.title}</p>
          <p className="docs-card-body">{block.body}</p>
          <Link href={block.href} className="docs-button mt-3">
            Go to {block.href}
          </Link>
        </div>
      );
    case "cardGrid":
      return <DocsBentoGrid key={key} items={block.items} />;
    case "heroMedia":
      return <DocsHeroMedia key={key} />;
    case "flywheelOverview":
      return <DocsFlywheelOverview key={key} />;
    case "arTokenPanel":
      return <DocsArTokenPanel key={key} />;
    case "partnerList":
      return <DocsPartnersGrid key={key} />;
    case "roadmapPage":
      return <DocsRoadmapPage key={key} />;
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}
export function DocsPageSection({ page }: { readonly page: DocsPage }) {
  const spec = getDocsPageSpec(page.slug);
  if (!spec) return null;
  const displayPage: DocsPage = {
    ...page,
    title: getDocsPageTitle(page),
    description: getDocsPageSubtitle(page),
  };
  return (
    <article className="w-full">
      <DocsPageHeader page={displayPage} />
      <div className="docs-prose">{spec.blocks.map((block, i) => renderBlock(block, `root-${i}`))}</div>
    </article>
  );
}