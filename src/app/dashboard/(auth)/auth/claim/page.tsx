import { DashboardClaimForm } from "@/app/dashboard/(auth)/auth/claim/claim-form";
import { readDashboardClaimToken } from "@/lib/dashboard/claim-page.server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export const dynamic = "force-dynamic";

export default async function DashboardAuthClaimPage({ searchParams }: Props) {
  const token = first((await searchParams).token);
  const tokenInfo = await readDashboardClaimToken(token).catch(() => ({
    valid: false,
    error: "Could not validate link.",
  }));
  return (
    <div className="ui-auth-page ui-auth-youtube bg-[#0f0f0f] text-[#f1f1f1]">
      <DashboardClaimForm token={token} tokenInfo={tokenInfo} />
    </div>
  );
}
