import Link from "next/link";
import { ExternalLink } from "lucide-react";
import type { DocsPartner, DocsPartnerLink } from "@/content/docs-partners";
import { docsProseClassName } from "@/lib/docs-prose";
import { cn } from "@/lib/utils";
function LinkList({
  title,
  links,
}: {
  readonly title: string;
  readonly links: readonly DocsPartnerLink[];
}) {
  if (links.length === 0) return null;
  return (
    <div>
      <h2 className="font-semibold text-lg mt-8 mb-3 text-foreground">{title}</h2>
      <ul className="list-disc ml-5 sm:ml-6 space-y-1 text-muted-foreground">
        {links.map((item) => (
          <li key={item.href}>
            {item.external === false ? (
              <Link href={item.href} className="text-primary underline-offset-2 hover:underline">
                {item.label}
              </Link>
            ) : (
              <a href={item.href} className="text-primary underline-offset-2 hover:underline inline-flex items-center gap-1" rel="noopener noreferrer">
                {item.label}
                <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
export function PartnerDetailBody({
  partner,
  children,
  className,
}: {
  readonly partner: DocsPartner;
  readonly children?: React.ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn(docsProseClassName, className)}>
      <p className="text-muted-foreground">{partner.tagline}</p>
      <h2 className="font-semibold text-lg mt-8 mb-3 text-foreground">About</h2>
      <ul>
        {partner.highlights.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {children}
      {partner.chain || partner.tags?.length || partner.capabilities?.length || partner.integrationStatus ? (
        <div>
          <h2 className="font-semibold text-lg mt-8 mb-3 text-foreground">Details</h2>
          <ul className="list-none space-y-2 text-muted-foreground">
            {partner.chain ? (
              <li>
                <span className="font-medium text-foreground">Chain: </span>
                {partner.chain}
              </li>
            ) : null}
            {partner.integrationStatus ? (
              <li>
                <span className="font-medium text-foreground">Integration: </span>
                {partner.integrationStatus}
              </li>
            ) : null}
            {partner.tags && partner.tags.length > 0 ? (
              <li>
                <span className="font-medium text-foreground">Tags: </span>
                {partner.tags.join(", ")}
              </li>
            ) : null}
            {partner.capabilities && partner.capabilities.length > 0 ? (
              <li>
                <span className="font-medium text-foreground">Capabilities: </span>
                <ul className="list-disc ml-5 mt-1 space-y-1">
                  {partner.capabilities.map((cap) => (
                    <li key={cap}>{cap}</li>
                  ))}
                </ul>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
      <LinkList title="Official links" links={partner.socials} />
      <LinkList title="Related on AgentRanking" links={partner.relatedOnAgentRanking} />
    </div>
  );
}