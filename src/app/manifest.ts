import type { MetadataRoute } from "next";
/**
 * Use same-origin relative icon paths so apex (agentranking.io) does not
 * fetch app.agentranking.io assets (CORS / redirect failures in the browser).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgentRanking",
    short_name: "AgentRanking",
    description:
      "Discover blockchain AI agents across SAP, ERC-8004, Solana, and MCP services. Compare trust, reviews, and rankings.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/icon.png",
        sizes: "48x48",
        type: "image/png",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
