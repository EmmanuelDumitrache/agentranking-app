import type { NextConfig } from "next";
import { resolveBuildTimeEnvironment } from "./src/lib/ipfs/public-gateway-config.mjs";
/** Repo root (next.config lives here). Stops Turbopack from mis-inferring `src/app` as the root. */
const turbopackRoot = import.meta.dirname;
const isProd = process.env.NODE_ENV === "production";
const buildTimeEnv = resolveBuildTimeEnvironment(process.env, {
  production: isProd,
});
const publicIpfsGateway = buildTimeEnv.NEXT_PUBLIC_IPFS_GATEWAY_URL;
const ipfsImageRemotePattern = (() => {
  if (!publicIpfsGateway) return null;
  const url = new URL(publicIpfsGateway);
  const basePath = url.pathname.replace(/\/+$/, "") || "/ipfs";
  return {
    protocol: url.protocol.slice(0, -1) as "http" | "https",
    hostname: url.hostname,
    port: url.port,
    pathname: `${basePath}/**`,
    search: "",
  };
})();
const deploymentId = process.env.NEXT_DEPLOYMENT_ID?.trim() || undefined;
const nextConfig: NextConfig = {
  reactCompiler: true,
  // Derive browser-visible values from the authoritative root environment at
  // configuration time. This replaces the removed generated runtime env files.
  env: {
    ...buildTimeEnv,
    // Single DEMO_MODE switch for both server and browser bundles.
    NEXT_PUBLIC_DEMO_MODE: process.env.DEMO_MODE === "true" ? "true" : "false",
  },
  ...(!isProd
    ? {
        // Dashboard dev host — OAuth/login runs here; must match NEXTAUTH_URL in development.
        allowedDevOrigins: ["app.agentranking.localhost"],
      }
    : {}),
  // Pin client/server protocol assets to the deployed build identifier. Next can
  // detect navigation or Server Function skew and force a consistent hard navigation.
  deploymentId,
  // Next 16 uses Turbopack for both development and production builds.
  turbopack: {
    root: turbopackRoot,
  },
  // Heavy ISR pages (home stats) can exceed the default 60s on small build machines.
  staticPageGenerationTimeout: 180,
  // `pg` must not be bundled into Route Handlers — use Node's native driver at runtime.
  serverExternalPackages: [
    "pg",
    "@prisma/adapter-pg",
    // bigint-buffer resolves an optional native .node binding at runtime; keep it out of Turbopack server chunks.
    "bigint-buffer",
    "redis",
    "@redis/client",
    "@zkmedusa/passport-sdk",
    "solana-agent-kit",
    // Yellowstone 1.3.0 loads its Solana encoding WASM from the package
    // directory at runtime. Keep that Node-specific dependency external so
    // Turbopack does not freeze its __dirname to the synthetic /ROOT build path.
    "@triton-one/yellowstone-grpc",
    // plugin-defi is intentionally NOT externalized. Its published transitive
    // graph still imports Noble v1 subpaths; native resolution inside Next's
    // flattened standalone node_modules can bind those imports to Noble v2.
    // Bundling/transpiling the graph preserves pnpm's package-local v1 edges.
    "@solana-agent-kit/plugin-token",
    "@solana-agent-kit/plugin-nft",
    "@solana-agent-kit/plugin-misc",
    "@solana-agent-kit/plugin-blinks",
  ],
  // Keep the DeFi graph inside Turbopack's dependency graph so package-local
  // @noble/hashes@1.8.0 resolution from pnpm packageExtensions is retained in
  // standalone output rather than flattened through Node's external resolver.
  transpilePackages: ["@solana-agent-kit/plugin-defi"],
  // Yellowstone's encoder reads this asset with fs at runtime, which static
  // tracing cannot infer from the generated loader. Include it explicitly in
  // every Node server trace while leaving the rest of plugin-defi bundled.
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/.pnpm/@triton-one+yellowstone-grpc@*/node_modules/@triton-one/yellowstone-grpc/dist/encoding/*.wasm",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Signal",
            value: "search=yes, ai-train=no",
          },
        ],
      },
      {
        // Keep machine endpoints out of search results even if directly linked or probed.
        source: "/api/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive",
          },
        ],
      },
      {
        source: "/fonts/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      ...(!isProd
        ? [
            {
              // Prevent stale development chunks from hydrating over fresh RSC HTML.
              source: "/_next/static/:path*",
              headers: [
                {
                  key: "Cache-Control",
                  value: "no-store, must-revalidate",
                },
              ],
            },
          ]
        : []),
      {
        source:
          "/:asset(icon.png|icon-192.png|apple-icon.png|logo-icon.png|favicon.ico)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=604800, stale-while-revalidate=2592000",
          },
        ],
      },
      {
        source: "/docs/:path*",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
      },
      {
        // Sitemap child files: cache for 24 hours at CDN.
        source: "/sitemap/:id.xml",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Admin route consolidation.
      {
        source: "/admin/power-rankings",
        destination: "/admin/dao-votes",
        permanent: true,
      },
      {
        source: "/admin/promotions",
        destination: "/admin/dao-votes",
        permanent: true,
      },
      // Removed utility-paper routes resolve directly to their canonical content.
      {
        source: "/token/utility-paper",
        destination: "/docs/staking",
        permanent: true,
      },
      {
        source: "/token/utility-paper/mission",
        destination: "/docs/ar-token",
        permanent: true,
      },
      {
        source: "/token/utility-paper/holder-utility",
        destination: "/docs/staking",
        permanent: true,
      },
      {
        source: "/token/utility-paper/staking-boost",
        destination: "/docs/staking",
        permanent: true,
      },
      {
        source: "/token/utility-paper/bounties-ar",
        destination: "/docs/jobs",
        permanent: true,
      },
      {
        source: "/token/utility-paper/mcp-fees",
        destination: "/docs/staking",
        permanent: true,
      },
      {
        source: "/token/utility-paper/buyback-burn",
        destination: "/docs/staking#revenue-flywheel",
        permanent: true,
      },
      {
        source: "/token/utility-paper/roadmap",
        destination: "/docs/roadmap",
        permanent: true,
      },
      {
        source: "/token/utility-paper/transparency",
        destination: "/docs/staking#treasury-and-transparency",
        permanent: true,
      },
      {
        source: "/token/utility-paper/supply-safety",
        destination: "/docs/staking#treasury-and-transparency",
        permanent: true,
      },
      {
        source: "/token/utility-paper/dashboard-access",
        destination: "/docs/dashboard",
        permanent: true,
      },
      {
        source: "/token/utility-paper/locked-supply",
        destination: "/locked-supply",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      // Sitemap index must not live at `app/sitemap.xml/` (conflicts with metadata `sitemap.ts` child routes).
      { source: "/sitemap.xml", destination: "/api/sitemap-index" },
      // Public widget URL: serve a standalone HTML document (iframe-safe) without mounting inside the App Router.
      { source: "/embed/agent/:id", destination: "/api/embed/agent/:id" },
    ];
  },
  poweredByHeader: false,
  // Off by default in prod (smaller downloads, less parse). Set ENABLE_BROWSER_SOURCEMAPS=1 to debug prod in browser.
  productionBrowserSourceMaps: process.env.ENABLE_BROWSER_SOURCEMAPS === "1",
  images: {
    formats: ["image/webp"],
    qualities: [75],
    minimumCacheTTL: 60 * 60 * 24,
    maximumRedirects: 0,
    maximumResponseBody: 8_000_000,
    maximumDiskCacheSize: 2_000_000_000,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "icons.llamao.fi",
        port: "",
        pathname: "/icons/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        port: "",
        pathname: "/wikipedia/**",
        search: "",
      },
      ...(ipfsImageRemotePattern ? [ipfsImageRemotePattern] : []),
    ],
  },
};
export default nextConfig;
