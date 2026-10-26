import {
  generatePublicAgentDetailMetadata,
  PublicAgentDetailRoute,
} from "@/lib/public-site/agent-detail-page.server";

export const dynamic = "force-dynamic";
export const generateMetadata = generatePublicAgentDetailMetadata;
export default PublicAgentDetailRoute;
