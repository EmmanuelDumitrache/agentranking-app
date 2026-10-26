"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { PublicSiteChrome } from "@/components/public-site/public-site-chrome";
import providerScope from "@/lib/public-site/provider-scope.json";
import type { PublicFooterColumn, PublicNavItem } from "@/lib/site-config";

const AuthWalletProviders = dynamic(() =>
  import("@/providers/auth-wallet-providers").then(
    (module) => module.AuthWalletProviders,
  ),
);
const PublicQueryProviders = dynamic(() =>
  import("@/providers/public-query-providers").then(
    (module) => module.PublicQueryProviders,
  ),
);
const PublicSessionProviders = dynamic(() =>
  import("@/providers/public-session-providers").then(
    (module) => module.PublicSessionProviders,
  ),
);

const FOOTER_HIDDEN_PREFIXES = ["/agents", "/tokens", "/world"] as const;

type RouteScope = {
  readonly exact: readonly string[];
  readonly prefixes: readonly string[];
};

function pathMatchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function pathMatchesScope(pathname: string, scope: RouteScope): boolean {
  return (
    scope.exact.includes(pathname) ||
    scope.prefixes.some((prefix) => pathMatchesPrefix(pathname, prefix))
  );
}

function shouldShowPublicSiteFooter(pathname: string): boolean {
  return !FOOTER_HIDDEN_PREFIXES.some((prefix) => pathMatchesPrefix(pathname, prefix));
}

export function PublicSiteLayoutClient({
  children,
  navLinks,
  footerColumns,
}: {
  readonly children: React.ReactNode;
  readonly navLinks: readonly PublicNavItem[];
  readonly footerColumns: readonly PublicFooterColumn[];
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isWorld = pathname === "/world";
  const needsWallet = pathMatchesScope(pathname, providerScope.wallet);
  const needsQuery = !needsWallet && pathMatchesScope(pathname, providerScope.query);
  const needsSession = pathMatchesScope(pathname, providerScope.session);
  let content: React.ReactNode = (
    <PublicSiteChrome
      navLinks={navLinks}
      footerColumns={footerColumns}
      showFooter={shouldShowPublicSiteFooter(pathname) && !isHome}
      hideWaveBackground={isHome || isWorld}
      hideNav={isWorld}
      mainClassName={
        isHome
          ? "ui-main--landing-v3"
          : isWorld
            ? "ui-main--world !p-0 !overflow-hidden"
            : undefined
      }
    >
      {isHome || isWorld ? children : <div className="ui-public-site-container">{children}</div>}
    </PublicSiteChrome>
  );

  // WalletProvider owns the QueryProvider required by Wagmi/RainbowKit. Keep
  // each optional runtime behind its own route-gated chunk so pages such as
  // `/ranking` do not download wallet, query, or session dependencies.
  if (needsWallet) {
    content = <AuthWalletProviders>{content}</AuthWalletProviders>;
  } else if (needsQuery) {
    content = <PublicQueryProviders>{content}</PublicQueryProviders>;
  }

  if (needsSession) {
    content = <PublicSessionProviders>{content}</PublicSessionProviders>;
  }

  return content;
}
