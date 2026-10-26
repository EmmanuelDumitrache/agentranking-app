import { NextResponse } from "next/server";

/** JSON response for authentication and security endpoints; never browser/CDN cache it. */
export function securityJsonResponse(
  body: unknown,
  init: ResponseInit = {},
): NextResponse {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return NextResponse.json(body, { ...init, headers });
}
