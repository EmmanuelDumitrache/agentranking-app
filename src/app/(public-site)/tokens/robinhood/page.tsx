import { RuntimeImage } from "@/components/shared/runtime-image";
import type { Metadata } from "next";
import Link from "next/link";
import { listRobinhoodLaunches } from "@/lib/robinhood-chain/record-launch.server";
import { robinhoodTokenImageUrl } from "@/lib/robinhood-chain/resolve-token-image";
import { Badge } from "@/components/ui/badge";
import { publicSitePageMetadata } from "@/lib/public-site/seo-metadata";
import { publicSiteSocialOgImageUrl } from "@/lib/social-og-images";
export const metadata: Metadata = publicSitePageMetadata({
  title: "Robinhood Chain Tokens | AgentRanking",
  description: "Tokenized agent launches on Robinhood Chain indexed by AgentRanking.",
  path: "/tokens/robinhood",
  imageUrl: publicSiteSocialOgImageUrl("robinhoodTokens"),
});
export const dynamic = "force-dynamic";
export default async function RobinhoodTokensPage() {
  const launches = await listRobinhoodLaunches(50);
  return (
    <div className="ui-page-stack py-8">
      <div className="space-y-2">
        <Badge variant="secondary">Robinhood Chain</Badge>
        <h1 className="text-2xl font-bold">Robinhood Chain launches</h1>
        <p className="text-muted-foreground text-sm">
          AgentRanking Launch tokens on Robinhood Chain — source verified V3 liquidity.
        </p>
        <Link href="/launch?chain=robinhood" className="text-sm font-medium text-emerald-500 hover:underline">
          Launch on Robinhood Chain →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {launches.length === 0 ? (
          <p className="text-muted-foreground col-span-full text-sm">No launches indexed yet.</p>
        ) : (
          launches.map((launch) => {
            const imageUrl = robinhoodTokenImageUrl({
              tokenLogoGatewayUrl: launch.tokenLogoGatewayUrl,
              tokenLogoIpfsUri: launch.tokenLogoIpfsUri,
              tokenImageOriginalUrl: launch.tokenImageOriginalUrl,
              tokenImageUrl: launch.tokenImageUrl,
              tokenName: launch.tokenName,
              tokenSymbol: launch.tokenSymbol,
            });
            return (
            <Link
              key={launch.id}
              href={`/tokens/robinhood/${launch.tokenAddress}`}
              className="ui-panel block p-4 transition-colors hover:bg-muted/20"
            >
              <div className="flex items-start gap-3">
                {imageUrl ? (
                  <RuntimeImage src={imageUrl} alt="" className="h-12 w-12 rounded-xl border object-cover" />
                ) : (
                  <div className="bg-muted flex h-12 w-12 items-center justify-center rounded-xl border text-[10px] font-semibold uppercase text-muted-foreground">
                    {(launch.tokenSymbol ?? launch.tokenName ?? "?").slice(0, 3)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{launch.tokenName || "Unnamed"}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {launch.tokenSymbol ? `$${launch.tokenSymbol}` : "—"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge className="text-[10px]">{launch.frontendSourceLabel}</Badge>
                    {launch.sourceVerified ? (
                      <Badge className="bg-emerald-600/90 text-[10px]">Source verified</Badge>
                    ) : null}
                  </div>
                </div>
              </div>
            </Link>
            );
          })
        )}
      </div>
    </div>
  );
}
