import { VERIFIED_PAGE_SUBTITLE, VERIFIED_PAGE_TITLE } from "@/lib/verified-page-config";
import { getDashboardHomeUrl } from "@/lib/site-url";
import { VerifiedCTAButton } from "@/components/verified/verified-cta-button";
export function VerifiedPageHeader() {
  return (
    <header className="verified-page-header">
      <div className="verified-page-header-copy">
        <h1 className="verified-page-title">{VERIFIED_PAGE_TITLE}</h1>
        <p className="verified-page-subtitle">{VERIFIED_PAGE_SUBTITLE}</p>
      </div>
      <VerifiedCTAButton href={getDashboardHomeUrl()} className="verified-page-header-cta">
        Verify your agent
      </VerifiedCTAButton>
    </header>
  );
}
