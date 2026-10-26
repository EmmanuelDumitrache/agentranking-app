import { StakeSiteLink } from "@/app/stake/shell/stake-site-link";
import { BuyArTrigger } from "@/app/stake/shell/buy-ar-trigger";
import { TelegramLogo, XLogo } from "@/components/public-site/social-icons";
import type { PublicFooterColumn as StakeSiteFooterColumn } from "@/lib/site-config";
export function StakeSiteFooter({
  homeHref,
  columns,
  privacyHref,
  termsHref,
  showBuyAr,
}: {
  readonly homeHref: string;
  readonly columns: readonly StakeSiteFooterColumn[];
  readonly privacyHref: string;
  readonly termsHref: string;
  readonly showBuyAr?: boolean;
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-[var(--ar-border)]">
      <div className="ar-public-container py-7 sm:py-10">
        <div className="grid grid-cols-2 gap-x-6 gap-y-6 sm:gap-8 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1">
            <StakeSiteLink href={homeHref} className="text-[length:var(--ar-text-sm)] font-semibold text-[var(--ar-text-primary)]">
              AgentRanking
            </StakeSiteLink>
            <p className="mt-2 max-w-xs text-[11px] leading-[1.45] text-[var(--ar-text-tertiary)]">
              Discovery, reputation, and monetization for on-chain AI agents.
            </p>
            <div className="mt-3 flex gap-2">
              <a
                href="https://x.com/agentranking"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--ar-radius-sm)] border border-[var(--ar-border)] text-[var(--ar-text-secondary)] hover:border-[var(--ar-border-strong)]"
                aria-label="X"
              >
                <XLogo className="h-3.5 w-3.5" />
              </a>
              <a
                href="https://t.me/agentrankingtg"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--ar-radius-sm)] border border-[var(--ar-border)] text-[var(--ar-text-secondary)] hover:border-[var(--ar-border-strong)]"
                aria-label="Telegram"
              >
                <TelegramLogo className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <p className="ar-public-label mb-2">{col.title}</p>
              <ul className="space-y-1.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-[var(--ar-text-secondary)] hover:text-[var(--ar-text-primary)]"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <StakeSiteLink
                        href={link.href}
                        className="text-[11px] text-[var(--ar-text-secondary)] hover:text-[var(--ar-text-primary)]"
                      >
                        {link.label}
                      </StakeSiteLink>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-col gap-2 border-t border-[var(--ar-border)] pt-5 text-[10px] text-[var(--ar-text-muted)] sm:mt-8 sm:flex-row sm:items-center sm:justify-between sm:pt-6">
          <p>© {year} AgentRanking. No fixed APY on staking rewards.</p>
          <div className="flex flex-wrap gap-3">
            {showBuyAr ? <BuyArTrigger /> : null}
            <StakeSiteLink href={privacyHref} className="hover:text-[var(--ar-text-secondary)]">
              Privacy
            </StakeSiteLink>
            <StakeSiteLink href={termsHref} className="hover:text-[var(--ar-text-secondary)]">
              Terms
            </StakeSiteLink>
          </div>
        </div>
      </div>
    </footer>
  );
}
