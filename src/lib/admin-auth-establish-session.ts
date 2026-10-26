
import { getIronSession } from "iron-session";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  computeAdminSessionExpiresAt,
  getSessionOptions,
  type AdminSession,
} from "@/lib/admin-auth-session";
import { getAdminSessionUsername } from "@/lib/admin-email-login";
import { getClientIp } from "@/lib/client-ip";
function applySessionFields(
  session: AdminSession,
  request: NextRequest | Request,
  rememberMe: boolean,
): void {
  const now = Date.now();
  const ip = getClientIp(request);
  session.username = getAdminSessionUsername();
  session.createdAt = now;
  session.expiresAt = computeAdminSessionExpiresAt(rememberMe);
  session.lastAccessAt = now;
  if (ip) session.lastAccessIp = ip;
}
/** Sets iron-session on a Route Handler response (required for Set-Cookie on redirects/JSON). */
export async function establishAdminSessionOnResponse(
  request: NextRequest | Request,
  response: NextResponse,
  rememberMe: boolean,
): Promise<void> {
  const session = await getIronSession<AdminSession>(request, response, getSessionOptions());
  applySessionFields(session, request, rememberMe);
  await session.save();
}