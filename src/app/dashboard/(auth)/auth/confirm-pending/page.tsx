import { DashboardConfirmPendingClient } from "@/app/dashboard/(auth)/auth/confirm-pending/confirm-pending-client";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function DashboardAuthConfirmPendingPage({ searchParams }: Props) {
  const email = first((await searchParams).email);
  return (
    <div className="ui-auth-page ui-auth-youtube bg-[#0f0f0f] text-[#f1f1f1]">
      <DashboardConfirmPendingClient email={email} />
    </div>
  );
}
