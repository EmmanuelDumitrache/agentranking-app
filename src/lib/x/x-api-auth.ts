/** App-only bearer or OAuth2 user token for X API v2 read endpoints. */
export function getXApiBearerToken(): string | null {
  const bearer = process.env.X_BEARER_TOKEN?.trim();
  if (bearer) return bearer;
  const oauth2 = process.env.X_OAUTH2_USER_ACCESS_TOKEN?.trim();
  if (oauth2) return oauth2;
  return null;
}