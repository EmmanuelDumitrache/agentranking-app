"use client";
import { ExternalLink } from "lucide-react";
import { getWurkServiceCatalog } from "@/lib/jobs/partners/wurk-service-catalog";
import { cn } from "@/lib/utils";
type Props = {
  readonly compact?: boolean;
  readonly className?: string;
};
export function WurkServiceCatalogPanel({ compact = false, className }: Props) {
  const items = getWurkServiceCatalog();
  return (
    <section className={cn("jobs-sidebar-panel", compact && "jobs-sidebar-panel--compact", className)}>
      <h3 className="jobs-sidebar-title">WURK service families</h3>
      <p className="jobs-sidebar-subcopy">
        Human-in-loop execution rails — context only, not live job listings.
      </p>
      <ul className="jobs-wurk-catalog">
        {items.map((item) => (
          <li key={item.id} className="jobs-wurk-catalog-item">
            <div className="jobs-wurk-catalog-head">
              <p className="jobs-wurk-catalog-name">{item.name}</p>
              <a
                href={item.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="jobs-wurk-catalog-docs"
                aria-label={`${item.name} docs`}
              >
                <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </div>
            <p className="jobs-wurk-catalog-desc">{item.description}</p>
            {item.routeFamily ? (
              <p className="jobs-wurk-catalog-route">{item.routeFamily}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}