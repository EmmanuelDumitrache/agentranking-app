import { PublicSiteBackground } from "@/components/public-site/public-site-background";
import { StakeSiteScope } from "@/app/stake/shell/stake-site-scope";

export function StakeSiteShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <StakeSiteScope>
      <div className="ar-public ar-public-page-bg ar-public-page-bg--ethereal min-h-screen overflow-x-clip scroll-smooth text-[var(--ar-text-primary)]">
        <PublicSiteBackground />
        {children}
      </div>
    </StakeSiteScope>
  );
}
