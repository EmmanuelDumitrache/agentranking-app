import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ agentDbId: string }> };

/** Legacy agent-scoped URL — verification is account-level. */
export default async function LegacyAgentVerifyRedirectPage(_props: Props) {
  redirect("/dashboard/verify");
}
