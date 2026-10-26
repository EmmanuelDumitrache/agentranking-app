import { JOBS_PAGE_SUBTITLE, JOBS_PAGE_TITLE } from "@/lib/jobs-page-config";
import { JobsPartnerStrip } from "@/components/jobs/jobs-partner-strip";
export function JobsPageHeader({
  stats,
}: {
  readonly stats: ReadonlyArray<{ label: string; value: number }>;
}) {
  return (
    <header className="jobs-page-header">
      <div className="jobs-page-header-copy">
        <h1 className="jobs-page-title">{JOBS_PAGE_TITLE}</h1>
        <p className="jobs-page-subtitle">{JOBS_PAGE_SUBTITLE}</p>
        {stats.length > 0 ? (
          <dl className="jobs-page-stats">
            {stats.map((stat) => (
              <div key={stat.label} className="jobs-page-stat">
                <dt className="jobs-page-stat-label">{stat.label}</dt>
                <dd className="jobs-page-stat-value">{stat.value.toLocaleString()}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <JobsPartnerStrip />
      </div>
    </header>
  );
}