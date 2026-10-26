import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck,
  Building2,
  ClipboardList,
  Coins,
  Flag,
  Image,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  Newspaper,
  ShieldBan,
  ServerCog,
  ShoppingCart,
  Trophy,
  UserCircle2,
  Users,
} from "lucide-react";
export type AdminNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};
export type AdminNavGroup = {
  title: string;
  items: AdminNavItem[];
};
/**
 * Primary nav for day-to-day ops: creators, agents, commerce queue, support.
 * Specialized operational tools live under "More".
 */
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    title: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
      { href: "/admin/creators", label: "Creators", icon: UserCircle2 },
    ],
  },
  {
    title: "Agents",
    items: [
      { href: "/admin/verification-requests", label: "Verification queue", icon: ClipboardList },
      { href: "/admin/verified-agents", label: "Verified agents", icon: BadgeCheck },
      { href: "/admin/agent-reports", label: "Reports", icon: Flag },
      { href: "/admin/agent-blocklist", label: "Blocklist", icon: ShieldBan },
      { href: "/admin/mcp-operations", label: "MCP operations", icon: ServerCog },
    ],
  },
  {
    title: "Commerce",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
      { href: "/admin/ads", label: "Ads", icon: Image },
    ],
  },
  {
    title: "Growth",
    items: [
      { href: "/admin/ar-token", label: "$AR token", icon: Coins },
      { href: "/admin/news", label: "News", icon: Newspaper },
    ],
  },
  {
    title: "Support",
    items: [{ href: "/admin/contact", label: "Support inbox", icon: MessageCircle }],
  },
  {
    title: "More",
    items: [
      { href: "/admin/dao-votes", label: "Reputation", icon: Trophy },
      { href: "/admin/custom-listings", label: "Custom listings", icon: LayoutGrid },
      { href: "/admin/users", label: "User profiles", icon: Users },
      { href: "/admin/accounts", label: "Dashboard accounts", icon: Building2 },
    ],
  },
];
export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  // $AR sub-routes (staking, referrals, payouts) highlight the main $AR nav item.
  if (href === "/admin/ar-token") {
    return pathname === "/admin/ar-token" || pathname.startsWith("/admin/ar-token/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
export function isAdminNavGroupMuted(title: string): boolean {
  return title === "More";
}
