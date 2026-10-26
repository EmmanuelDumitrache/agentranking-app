import type { TokenDiscoveryCardModel } from "@/lib/agent-launch/launch-index-data.server";
import { TokenPreviewCarousel } from "@/components/public-site/token-preview-carousel";
type Props = {
  readonly tokens: readonly TokenDiscoveryCardModel[];
};
export function TokenPreviewSection({ tokens }: Props) {
  return <TokenPreviewCarousel tokens={tokens} />;
}
