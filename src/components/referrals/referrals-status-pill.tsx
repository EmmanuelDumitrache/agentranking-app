import { cn } from "@/lib/utils";
const STATUS_CLASS: Record<string, string> = {
  pending: "referrals-pill--pending",
  approved: "referrals-pill--approved",
  paid: "referrals-pill--paid",
  rejected: "referrals-pill--rejected",
};
export function ReferralsStatusPill({ status }: { readonly status: string }) {
  return (
    <span className={cn("referrals-pill", STATUS_CLASS[status] ?? "referrals-pill--muted")}>
      {status}
    </span>
  );
}