import { PublicSiteLayoutClient } from "@/app/(public-site)/public-site-layout-client";
import { PublicSiteScope } from "@/components/public-site/public-site-scope";
import { buildPublicFooterColumns, buildPublicNavLinks } from "@/lib/public-page-urls";

export default function PublicSiteLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const navLinks = buildPublicNavLinks();
  const footerColumns = buildPublicFooterColumns({ sameOrigin: true });
  return (
    <PublicSiteScope>
      <PublicSiteLayoutClient navLinks={navLinks} footerColumns={footerColumns}>
        {children}
      </PublicSiteLayoutClient>
    </PublicSiteScope>
  );
}
