const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

/**
 * Validate and canonicalize the public path-style IPFS gateway base.
 *
 * @param {string | null | undefined} rawValue
 * @param {{ name?: string; production?: boolean }} [options]
 * @returns {string}
 */
export function normalizePublicIpfsGateway(rawValue, options = {}) {
  const name = options.name ?? "IPFS_GATEWAY_URL";
  const raw = rawValue?.trim() ?? "";
  if (!raw) return "";

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) URL`);
  }

  if (!HTTP_PROTOCOLS.has(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not contain URL credentials`);
  }
  if (options.production && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS in production`);
  }
  if (url.search) {
    throw new Error(`${name} must not contain a query string`);
  }
  if (url.hash) {
    throw new Error(`${name} must not contain a fragment`);
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.toLowerCase().endsWith("/ipfs")) {
    throw new Error(`${name} must end with /ipfs`);
  }

  url.pathname = pathname;
  return url.toString().replace(/\/+$/, "");
}

/**
 * Resolve the browser-visible Solana cluster once, before the Next.js build.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string}
 */
function resolvePublicSolanaNetwork(env) {
  return (
    env.NEXT_PUBLIC_SOLANA_NETWORK?.trim() ||
    env.NEXT_PUBLIC_AR_SOLANA_CLUSTER?.trim() ||
    "mainnet-beta"
  );
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {string} publicIpfsGatewayUrl
 * @returns {{
 *   NEXT_PUBLIC_IPFS_GATEWAY_URL: string;
 *   NEXT_PUBLIC_SOLANA_NETWORK: string;
 * }}
 */
function buildTimeEnvironment(env, publicIpfsGatewayUrl) {
  return {
    NEXT_PUBLIC_IPFS_GATEWAY_URL: publicIpfsGatewayUrl,
    NEXT_PUBLIC_SOLANA_NETWORK: resolvePublicSolanaNetwork(env),
  };
}

/**
 * Resolve browser-visible values directly from the authoritative root environment.
 * IPFS_GATEWAY_URL remains the single public-gateway setting; Next.js exposes its
 * normalized value as NEXT_PUBLIC_IPFS_GATEWAY_URL during configuration.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @param {{ production?: boolean }} [options]
 * @returns {{
 *   NEXT_PUBLIC_IPFS_GATEWAY_URL: string;
 *   NEXT_PUBLIC_SOLANA_NETWORK: string;
 * }}
 */
export function resolveBuildTimeEnvironment(env, options = {}) {
  return buildTimeEnvironment(
    env,
    normalizePublicIpfsGateway(env.IPFS_GATEWAY_URL, {
      name: "IPFS_GATEWAY_URL",
      production: options.production,
    }),
  );
}
