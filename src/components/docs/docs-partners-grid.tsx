import Image from "next/image";
import Link from "next/link";
import { getDocsPartnerBySlug } from "@/content/docs-partners";
const MAJOR_PARTNER_SLUGS = ["xona-agent", "oobe-synapse", "medusa"] as const;
export function DocsPartnersGrid() {
  const partners = MAJOR_PARTNER_SLUGS.map((slug) => getDocsPartnerBySlug(slug)).filter(
    (partner): partner is NonNullable<typeof partner> => partner !== undefined,
  );
  return (
    <div className="docs-partners-grid">
      {partners.map((partner) => (
        <Link
          key={partner.slug}
          href={partner.hubHref ?? `/docs/partners/${partner.slug}`}
          className="docs-partner-card"
          {...(partner.hubExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        >
          {partner.logoSrc ? (
            <Image
              src={partner.logoSrc}
              alt=""
              width={24}
              height={24}
              className="docs-partner-card-logo"
              aria-hidden
            />
          ) : (
            <span className="docs-partner-card-logo-fallback" aria-hidden>
              {partner.name.slice(0, 1)}
            </span>
          )}
          <span className="docs-partner-card-name">{partner.name}</span>
          <span className="docs-partner-card-body">{partner.tagline}</span>
        </Link>
      ))}
    </div>
  );
}