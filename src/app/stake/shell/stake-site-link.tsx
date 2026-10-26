import Link from "next/link";
import type { MouseEventHandler, ReactNode } from "react";
function isAbsoluteHttpUrl(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}
/** Nav/footer links: in-app paths use Next Link; hashes + absolute URLs use `<a>`. */
export function StakeSiteLink({
  href,
  className,
  children,
  external,
  onClick,
}: {
  readonly href: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
  readonly external?: boolean;
  readonly onClick?: MouseEventHandler<HTMLAnchorElement>;
}) {
  if (!href) {
    return <span className={className}>{children}</span>;
  }
  const isHash = href.startsWith("#");
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
      <a href={href} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}
