import Link from "next/link";
import { VERIFIED_REFERRAL_LINE } from "@/lib/verified-page-config";
export function VerifiedReferralFooter() {
  return (
    <footer className="verified-referral-footer">
      <span>{VERIFIED_REFERRAL_LINE}</span>
      <Link href="/token/referrals" className="verified-text-link">
        Open referrals
      </Link>
    </footer>
  );
}