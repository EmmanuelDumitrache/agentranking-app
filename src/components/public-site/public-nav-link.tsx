import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";
function isAbsoluteHttpUrl(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}
function hashOnCurrentPage(href: string, pathname?: string): string | null {
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) return null;
  const path = href.slice(0, hashIndex) || "/";
  const hash = href.slice(hashIndex);
  if (!hash || hash === "#") return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return null;
  let current = pathname;
  if (current == null && typeof window !== "undefined") {
    current = window.location.pathname;
  }
  if (current == null) return null;
  if ((path === "" || path === "/") && (current === "/" || current === "")) return hash;
  return null;
}
/** Nav/footer links: in-app paths use Next Link; hashes + absolute URLs use `<a>`. */
export function PublicNavLink({
  href,
  className,
  children,
  external,
  onClick,
  pathname,
}: {
  readonly href: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
  readonly external?: boolean;
  readonly onClick?: MouseEventHandler<HTMLAnchorElement>;
  readonly pathname?: string;
}) {
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  const samePageHash = hashOnCurrentPage(href, pathname);
  const isHash = href.startsWith("#") || Boolean(samePageHash);
  const outbound = isAbsoluteHttpUrl(href);
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={onClick}
      >
        {children}
      </a>
    );
  }
  if (isHash || outbound) {
    return (
      <a href={samePageHash ?? href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick} prefetch={false}>
      {children}
    </Link>
  );
}
