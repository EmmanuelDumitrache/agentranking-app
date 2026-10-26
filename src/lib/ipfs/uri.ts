import { CID } from "multiformats/cid";

const IPFS_SCHEME = "ipfs://";
const IPFS_PATH_MARKER = "/ipfs/";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isValidCid(value: string): boolean {
  try {
    CID.parse(value);
    return true;
  } catch {
    return false;
  }
}

function normalizePathSegments(value: string): string | null {
  const withoutDecorators = value.split(/[?#]/, 1)[0]?.replace(/^\/+/, "").trim() ?? "";
  if (!withoutDecorators || withoutDecorators.includes("\\") || withoutDecorators.includes("\0")) {
    return null;
  }

  const segments = withoutDecorators.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const decoded = segments.map(decodePathSegment);
  if (
    decoded.some(
      (segment) =>
        segment === null ||
        segment === "." ||
        segment === ".." ||
        segment.includes("/") ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return null;
  }

  const safeSegments = decoded as string[];
  const [root, ...rest] = safeSegments;
  if (!root || !isValidCid(root)) return null;

  return [root, ...rest.map((segment) => encodeURIComponent(segment))].join("/");
}

function subdomainGatewayPath(url: URL): string | null {
  const labels = url.hostname.toLowerCase().split(".");
  if (labels.length < 3 || labels[1] !== "ipfs") return null;

  const cid = labels[0];
  if (!cid || !isValidCid(cid)) return null;

  const suffix = url.pathname.replace(/^\/+/, "");
  return normalizePathSegments(suffix ? `${cid}/${suffix}` : cid);
}

export function normalizeIpfsGatewayBase(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/, "");
    url.pathname = pathname.toLowerCase().endsWith("/ipfs")
      ? pathname
      : `${pathname}/ipfs`;
    return trimTrailingSlash(url.toString());
  } catch {
    return null;
  }
}

/** Return `CID[/path]` from an IPFS URI, path/subdomain gateway URL, `/ipfs/...`, or bare CID path. */
export function extractIpfsPath(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  if (raw.toLowerCase().startsWith(IPFS_SCHEME)) {
    return normalizePathSegments(raw.slice(IPFS_SCHEME.length).replace(/^ipfs\//i, ""));
  }

  if (raw.startsWith(IPFS_PATH_MARKER)) {
    return normalizePathSegments(raw.slice(IPFS_PATH_MARKER.length));
  }

  try {
    const url = new URL(raw);
    const markerIndex = url.pathname.toLowerCase().indexOf(IPFS_PATH_MARKER);
    if (markerIndex >= 0) {
      return normalizePathSegments(url.pathname.slice(markerIndex + IPFS_PATH_MARKER.length));
    }
    return subdomainGatewayPath(url);
  } catch {
    return normalizePathSegments(raw);
  }
}

export function buildIpfsGatewayUrl(
  gatewayBase: string | null | undefined,
  cidOrUri: string | null | undefined,
): string | null {
  const base = normalizeIpfsGatewayBase(gatewayBase);
  const path = extractIpfsPath(cidOrUri);
  if (!base || !path) return null;
  return `${base}/${path}`;
}

export function buildIpfsUri(cidOrUri: string | null | undefined): string | null {
  const path = extractIpfsPath(cidOrUri);
  return path ? `${IPFS_SCHEME}${path}` : null;
}

export function browserIpfsGatewayUrl(cidOrUri: string | null | undefined): string | null {
  return buildIpfsGatewayUrl(process.env.NEXT_PUBLIC_IPFS_GATEWAY_URL, cidOrUri);
}
