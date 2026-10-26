import {
  BadgeCheck,
  Coins,
  DollarSign,
  MousePointerClick,
  Share2,
  type LucideIcon,
} from "lucide-react";
export const REFERRALS_PAGE_TITLE = "Referral program";
export const REFERRALS_PAGE_SUBTITLE =
  "Earn $AR by referring developers and agent builders. Verification referrals pay the most.";
export const REFERRALS_HOW_IT_WORKS: ReadonlyArray<{
  icon: LucideIcon;
  title: string;
  desc: string;
}> = [
  {
    icon: Share2,
    title: "Share your link",
    desc: "Share your unique referral URL or QR code with developers building AI agents.",
  },
  {
    icon: MousePointerClick,
    title: "They click & land",
    desc: "Clicks are attributed to you via a 30-day tracking cookie.",
  },
  {
    icon: BadgeCheck,
    title: "They purchase a service",
    desc: "Agent Verification, ad packages, and Agent Dashboard Pro subscriptions earn commission.",
  },
  {
    icon: Coins,
    title: "Commission calculated",
    desc: "5% on verification, 10% on Dashboard Pro and ad packages — paid in $AR.",
  },
  {
    icon: DollarSign,
    title: "Admin approves & pays out",
    desc: "Commissions are reviewed and paid manually to your wallet in $AR.",
  },
];
export const REFERRALS_COMMISSION_ROWS = [
  { product: "Agent Verification", price: "$99", rate: "5%", earn: "~$4.95" },
  { product: "Agent Dashboard Pro", price: "$39/mo", rate: "10%", earn: "~$3.90" },
  { product: "Ad Package", price: "$49–$199", rate: "10%", earn: "$4.90–$19.90" },
] as const;
export const REFERRALS_VERIFICATION_HIGHLIGHT = {
  title: "Biggest earner: Agent Verification",
  body: "At 5% commission, a successful $99 verification earns you ~$4.95 in $AR. One-time, high-value — the most rewarding product to promote.",
  href: "/dashboard",
  cta: "Open Agent Dashboard",
};
