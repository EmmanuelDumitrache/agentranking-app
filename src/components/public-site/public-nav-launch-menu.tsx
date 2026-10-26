import { LayoutDashboard, Rocket } from "lucide-react";
import type { ReactNode } from "react";
import { PublicNavLink } from "@/components/public-site/public-nav-link";
import { publicSiteRoutes } from "@/lib/public-site/routes";
import { cn } from "@/lib/utils";

const launchMenuItemClass =
  "flex w-full cursor-pointer items-center gap-2.5 px-2 py-2";

function LaunchMenuItem({
  href,
  icon,
  title,
  subtitle,
  onNavigate,
  className = launchMenuItemClass,
  titleClassName = "text-[13px] font-medium leading-none",
}: {
  readonly href: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly subtitle: string;
  readonly onNavigate?: () => void;
  readonly className?: string;
  readonly titleClassName?: string;
}) {
  return (
    <PublicNavLink href={href} className={className} onClick={onNavigate}>
      {icon}
      <span className="min-w-0">
        <span className={cn("block", titleClassName)}>{title}</span>
        <span className="text-muted-foreground mt-1 block text-[11px] leading-none">{subtitle}</span>
      </span>
    </PublicNavLink>
  );
}

type LaunchMenuItemsProps = {
  readonly onNavigate?: () => void;
  readonly itemClassName?: string;
  readonly titleClassName?: string;
};

export function PublicNavLaunchMenuItems({
  onNavigate,
  itemClassName = launchMenuItemClass,
  titleClassName = "text-sm font-medium leading-none",
}: LaunchMenuItemsProps) {
  return (
    <>
      <LaunchMenuItem
        href={publicSiteRoutes.launchApp}
        icon={<LayoutDashboard className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />}
        title="App"
        subtitle="Creator dashboard on app.agentranking.io"
        onNavigate={onNavigate}
        className={itemClassName}
        titleClassName={titleClassName}
      />
      <LaunchMenuItem
        href={publicSiteRoutes.launchToken}
        icon={<Rocket className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />}
        title="Quick launch"
        subtitle="Wallet-only token or agent on agentranking.io"
        onNavigate={onNavigate}
        className={itemClassName}
        titleClassName={titleClassName}
      />
    </>
  );
}
