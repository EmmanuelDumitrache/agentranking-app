"use client";
import Link from "next/link";
import type { DocsCardGridItemSpec } from "@/lib/docs/types";
function BentoCard({ item }: { readonly item: DocsCardGridItemSpec }) {
  const inner = (
    <>
      <p className="docs-card-title">{item.title}</p>
      <p className="docs-card-body">{item.description}</p>
      {item.href ? <span className="docs-card-link">Read more →</span> : null}
    </>
  );
  if (item.href) {
    return (
      <Link href={item.href} className="docs-bento-card group">
        {inner}
      </Link>
    );
  }
  return <div className="docs-bento-card">{inner}</div>;
}
export function DocsBentoGrid({ items }: { readonly items: readonly DocsCardGridItemSpec[] }) {
  return (
    <div className="docs-bento-grid">
      {items.map((item) => (
        <BentoCard key={`${item.title}-${item.href ?? "static"}`} item={item} />
      ))}
    </div>
  );
}