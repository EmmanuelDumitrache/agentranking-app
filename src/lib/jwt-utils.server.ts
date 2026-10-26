import "server-only";
/**
 * Server-side JWT utilities for the Privy authentication bridge.
 *
 * Signs short-lived JWTs (RS256) that identify the current NextAuth user
 * to Privy's custom-auth system.  The matching public JWK is served at
 * /.well-known/jwks.json so Privy's servers can verify the signature.
 */
/**
 * Server-side JWT utilities for the Privy authentication bridge.
 *
 * Signs short-lived JWTs (RS256) that identify the current NextAuth user
 * to Privy's custom-auth system.  The matching public JWK is served at
 * /.well-known/jwks.json so Privy's servers can verify the signature.
 */
/**
 * Server-side JWT utilities for the Privy authentication bridge.
 *
 * Signs short-lived JWTs (RS256) that identify the current NextAuth user
 * to Privy's custom-auth system.  The matching public JWK is served at
 * /.well-known/jwks.json so Privy's servers can verify the signature.
 */
/**
 * Server-side JWT utilities for the Privy authentication bridge.
 *
 * Signs short-lived JWTs (RS256) that identify the current NextAuth user
 * to Privy's custom-auth system.  The matching public JWK is served at
 * /.well-known/jwks.json so Privy's servers can verify the signature.
 */
import { SignJWT, importPKCS8, exportJWK } from "jose";
/* ─── Configuration (server-only env vars, never exposed to client) ─── */
const PRIVATE_KEY_B64 = process.env.PRIVY_JWT_PRIVATE_KEY_B64;
const JWT_ISSUER = process.env.PRIVY_JWT_ISSUER ?? "";
const JWT_AUDIENCE = process.env.PRIVY_JWT_AUDIENCE ?? "privy";
const JWT_KID = process.env.PRIVY_JWT_KID ?? "privy-jwt-20260710";
/** Short-lived JWT (10 minutes — Privy refreshes periodically). */
const JWT_EXPIRY = "10m";
/* ─── Lazy-loaded signing key ──────────────────────────────────────── */
let _privateKeyPromise: Promise<Awaited<ReturnType<typeof importPKCS8>>> | null = null;
async function getPrivateKey(): Promise<Awaited<ReturnType<typeof importPKCS8>>> {
  if (_privateKeyPromise) return _privateKeyPromise;
  if (!PRIVATE_KEY_B64) {
    throw new Error("PRIVY_JWT_PRIVATE_KEY_B64 is not configured.");
  }
  _privateKeyPromise = importPKCS8(
    Buffer.from(PRIVATE_KEY_B64, "base64").toString("utf-8"),
    "RS256",
    { extractable: true },
  );
  return _privateKeyPromise;
}
/* ─── Cached JWKS ──────────────────────────────────────────────────── */
let _jwksPromise: Promise<object> | null = null;
/** Public JWK matching the private signing key. */
export async function getPublicJwks(): Promise<object> {
  if (_jwksPromise) return _jwksPromise;
  _jwksPromise = (async () => {
    const privateKey = await getPrivateKey();
    const jwk = await exportJWK(privateKey);
    jwk.alg = "RS256";
    jwk.use = "sig";
    jwk.kid = JWT_KID;
    return { keys: [jwk] };
  })();
  return _jwksPromise;
}
/* ─── Cached local JWKS verifier ───────────────────────────────────── */


/* ─── Sign a Privy-bound JWT ──────────────────────────────────────── */
export interface PrivyJwtPayload {
  sub: string;        // stable AgentRanking UserProfile ID
  email?: string | null;
  iss: string;
  aud: string;
}
/**
 * Signs a short-lived RS256 JWT for Privy custom-auth.
 *
 * `sub` MUST be the stable internal UserProfile ID (integer → string).
 * Never derive `sub` from a mutable field like agent name or session email.
 */
export async function signPrivyJwt(payload: PrivyJwtPayload): Promise<string> {
  const privateKey = await getPrivateKey();
  return new SignJWT({
    sub: payload.sub,
    ...(payload.email ? { email: payload.email } : {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: JWT_KID })
    .setIssuer(payload.iss)
    .setAudience(payload.aud)
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(privateKey);
}
/* ─── Config accessors ─────────────────────────────────────────────── */
export function getJwtConfig() {
  return {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    kid: JWT_KID,
    configured: Boolean(PRIVATE_KEY_B64),
  };
}