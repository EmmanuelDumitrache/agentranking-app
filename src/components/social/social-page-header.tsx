import { SOCIAL_PAGE_SUBTITLE, SOCIAL_PAGE_TITLE } from "@/lib/social-page-config";
import type { SocialHubStats } from "@/components/social/social-types";
export function SocialPageHeader({ stats }: { readonly stats: SocialHubStats | null }) {
  return (
    <header className="social-page-header">
      <div className="social-page-header-copy">
        <h1 className="social-page-title">{SOCIAL_PAGE_TITLE}</h1>
        <p className="social-page-subtitle">{SOCIAL_PAGE_SUBTITLE}</p>
        {stats ? (
          <dl className="social-page-stats">
            <div className="social-page-stat">
              <dt className="social-page-stat-label">Profiles</dt>
              <dd className="social-page-stat-value">{stats.totalProfiles.toLocaleString()}</dd>
            </div>
            <div className="social-page-stat">
              <dt className="social-page-stat-label">Verified builders</dt>
              <dd className="social-page-stat-value social-page-stat-value--gold">
                {stats.verifiedProfiles.toLocaleString()}
              </dd>
            </div>
            <div className="social-page-stat">
              <dt className="social-page-stat-label">SAP claims</dt>
              <dd className="social-page-stat-value social-page-stat-value--success">
                {stats.claimedAgents.toLocaleString()}
              </dd>
            </div>
            <div className="social-page-stat">
              <dt className="social-page-stat-label">Avg AR</dt>
              <dd className="social-page-stat-value">
                {stats.avgArScore != null ? stats.avgArScore : "—"}
              </dd>
            </div>
          </dl>
        ) : null}
      </div>
    </header>
  );
}