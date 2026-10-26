"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  activeDashboardNavGroupIds,
  buildDashboardWorkspaceNavTree,
  isDashboardNavActive,
  isDashboardNavGroupActive,
  type DashboardNavGroupId,
  type DashboardNavGroupDef,
  type DashboardNavItem,
} from "@/lib/dashboard/navigation";
import { isDeveloperPreviewNavSection } from "@/lib/dashboard/developer-preview-sections";
import {
  DashboardNavComingSoonTooltip,
  DashboardNavDevPill,
  DashboardNavLockedAffordance,
} from "@/components/dashboard/dashboard-nav-preview-access";

const DashboardChatNavSubmenu = dynamic(
  () =>
    import("@/components/dashboard/chat-nav-submenu").then(
      (module) => module.DashboardChatNavSubmenu,
    ),
  { ssr: false, loading: () => null },
);

type NavVariant = "desktop" | "mobile";
type Props = {
  readonly activeAgentId: number | null;
  readonly pathname: string;
  readonly onNavigate?: () => void;
  readonly variant?: NavVariant;
  readonly isDeveloper?: boolean;
};
type ExpandedGroups = Record<DashboardNavGroupId, boolean>;
const NAV_GROUP_IDS: DashboardNavGroupId[] = ["agent", "trade", "build", "insights", "account"];

function resolveRouteOpenGroup(
  pathname: string,
  tree: ReturnType<typeof buildDashboardWorkspaceNavTree>,
): DashboardNavGroupId | null {
  return activeDashboardNavGroupIds(pathname, tree)[0] ?? null;
}
function WorkspaceNavLink({
  item,
  pathname,
  onNavigate,
  nested,
  variant,
  isDeveloper = false,
}: {
  readonly item: DashboardNavItem;
  readonly pathname: string;
  readonly onNavigate?: () => void;
  readonly nested?: boolean;
  readonly variant: NavVariant;
  readonly isDeveloper?: boolean;
}) {
  const Icon = item.icon;
  const active = isDashboardNavActive(pathname, item.href);
  const isPreviewSection = isDeveloperPreviewNavSection(item.id);
  const previewLocked = isPreviewSection && !isDeveloper;
  const previewDev = isPreviewSection && isDeveloper;

  if (previewLocked) {
    const lockedRow = (
      <span
        className={cn(
          variant === "mobile"
            ? "flex items-center gap-3 rounded-lg px-2 py-2.5 text-[15px] text-muted-foreground/55"
            : "ui-nav-link ui-nav-link--locked",
          nested && variant === "desktop" && "ui-nav-link--nested",
          nested && variant === "mobile" && "text-[14px]",
        )}
        aria-disabled="true"
      >
        <Icon className={variant === "mobile" ? "h-[18px] w-[18px] shrink-0" : "ui-nav-icon"} aria-hidden />
        <span className="truncate">{item.label}</span>
        <DashboardNavLockedAffordance />
      </span>
    );
    return (
      <DashboardNavComingSoonTooltip side={variant === "mobile" ? "top" : "right"}>
        {lockedRow}
      </DashboardNavComingSoonTooltip>
    );
  }

  if (variant === "mobile") {
    return (
      <Link
        href={item.href}
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-2 py-2.5 text-[15px] transition-colors",
          nested && "text-[14px]",
          active
            ? "bg-primary/10 text-foreground"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          previewDev && !active && "text-amber-100/85",
        )}
        aria-current={active ? "page" : undefined}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
        <span className="truncate">{item.label}</span>
        {previewDev ? <DashboardNavDevPill /> : null}
      </Link>
    );
  }
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "ui-nav-link",
        nested && "ui-nav-link--nested",
        active && "ui-nav-link--active",
        previewDev && !active && "ui-nav-link--dev-preview",
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon className="ui-nav-icon" aria-hidden />
      <span className="truncate">{item.label}</span>
      {previewDev ? <DashboardNavDevPill /> : null}
    </Link>
  );
}
function NavGroupSection({
  group,
  items,
  pathname,
  activeAgentId,
  expanded,
  onToggle,
  onNavigate,
  variant,
  isDeveloper = false,
}: {
  readonly group: DashboardNavGroupDef;
  readonly items: DashboardNavItem[];
  readonly pathname: string;
  readonly activeAgentId: number | null;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onNavigate?: () => void;
  readonly variant: NavVariant;
  readonly isDeveloper?: boolean;
}) {
  const GroupIcon = group.icon;
  const groupActive = isDashboardNavGroupActive(pathname, items);
  const groupControlId = `nav-group-${group.id}`;
  const panelId = `${groupControlId}-panel`;
  const panelItems = items.map((item) =>
    item.id === "chat" && activeAgentId ? (
      <div key={item.id}>
        <DashboardChatNavSubmenu
          agentDbId={activeAgentId}
          chatHref={item.href}
          pathname={pathname}
          onNavigate={onNavigate}
          nested
        />
      </div>
    ) : (
      <WorkspaceNavLink
        key={item.id}
        item={item}
        pathname={pathname}
        onNavigate={onNavigate}
        nested
        variant={variant}
        isDeveloper={isDeveloper}
      />
    ),
  );

  if (variant === "mobile") {
    return (
      <Collapsible open={expanded} className="ui-nav-group">
        <button
          type="button"
          id={groupControlId}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={onToggle}
          className={cn(
            "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-[15px] transition-colors",
            groupActive
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          <GroupIcon className="h-[18px] w-[18px] shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {group.label}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0 opacity-60 transition-transform duration-200 ease-out",
              expanded && "rotate-180",
            )}
          />
        </button>
        <CollapsibleContent
          id={panelId}
          role="region"
          aria-labelledby={groupControlId}
          className="ui-nav-group-panel ui-nav-group-panel--animated ui-nav-group-panel--mobile"
        >
          <div className="ui-nav-group-panel-inner">{panelItems}</div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible open={expanded} className="ui-nav-group">
      <button
        type="button"
        id={groupControlId}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={cn("ui-nav-link w-full text-left", groupActive && "ui-nav-link--active")}
      >
        <GroupIcon className="ui-nav-icon" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{group.label}</span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-out",
            expanded && "rotate-180",
          )}
        />
      </button>
      <CollapsibleContent
        id={panelId}
        role="region"
        aria-labelledby={groupControlId}
        className="ui-nav-group-panel ui-nav-group-panel--animated"
      >
        <div className="ui-nav-group-panel-inner">{panelItems}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
export function DashboardWorkspaceNav({
  activeAgentId,
  pathname,
  onNavigate,
  variant = "desktop",
  isDeveloper = false,
}: Props) {
  const tree = useMemo(
    () => buildDashboardWorkspaceNavTree(activeAgentId),
    [activeAgentId],
  );
  const routeOpenGroup = useMemo(
    () => resolveRouteOpenGroup(pathname, tree),
    [pathname, tree],
  );
  const [manualOpenGroupId, setManualOpenGroupId] = useState<
    DashboardNavGroupId | null | undefined
  >(undefined);
  const [prevPathname, setPrevPathname] = useState(pathname);

  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setManualOpenGroupId(undefined);
  }

  const openGroupId =
    manualOpenGroupId === undefined ? routeOpenGroup : manualOpenGroupId;

  const expandedGroups = useMemo((): ExpandedGroups => {
    return NAV_GROUP_IDS.reduce((acc, id) => {
      acc[id] = openGroupId === id;
      return acc;
    }, {} as ExpandedGroups);
  }, [openGroupId]);

  const toggleGroup = (id: DashboardNavGroupId) => {
    setManualOpenGroupId((current) => {
      const effective = current === undefined ? routeOpenGroup : current;
      return effective === id ? null : id;
    });
  };
  return (
    <>
      <WorkspaceNavLink
        item={tree.overview}
        pathname={pathname}
        onNavigate={onNavigate}
        variant={variant}
        isDeveloper={isDeveloper}
      />
      {tree.groups.map(({ group, items }) => (
        <NavGroupSection
          key={group.id}
          group={group}
          items={items}
          pathname={pathname}
          activeAgentId={activeAgentId}
          expanded={expandedGroups[group.id]}
          onToggle={() => toggleGroup(group.id)}
          onNavigate={onNavigate}
          variant={variant}
          isDeveloper={isDeveloper}
        />
      ))}
      <div
        className={
          variant === "desktop"
            ? "mt-1 border-t border-border/60 pt-2"
            : "mt-2 border-t border-border/60 pt-2"
        }
      >
        <WorkspaceNavLink
          item={tree.settings}
          pathname={pathname}
          onNavigate={onNavigate}
          variant={variant}
          isDeveloper={isDeveloper}
        />
      </div>
    </>
  );
}
