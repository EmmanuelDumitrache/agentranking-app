import { publicTokenDetailHref } from "@/lib/public-site/routes";
export type PublicAgentLinkedToken = {
  readonly launchId: string;
  readonly mint: string;
  readonly tokenSymbol: string | null;
  readonly tokenName: string | null;
  readonly launchHref: string;
};
type LaunchRow = {
  readonly id: string;
  readonly mint: string | null;
  readonly tokenSymbol: string | null;
  readonly tokenName: string | null;
};
export function pickPublicAgentLinkedToken(
  launches?: ReadonlyArray<LaunchRow> | null,
): PublicAgentLinkedToken | null {
  if (!launches?.length) return null;
  const launch = launches[0];
  if (!launch?.mint) return null;
  return {
    launchId: launch.id,
    mint: launch.mint,
    tokenSymbol: launch.tokenSymbol,
    tokenName: launch.tokenName,
    launchHref: publicTokenDetailHref(launch.mint),
  };
}
