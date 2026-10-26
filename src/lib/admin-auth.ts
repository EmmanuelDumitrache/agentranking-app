/** Re-export session helpers (middleware imports session-only bundle — avoids bcrypt on Edge). */
export type { AdminSession } from "./admin-auth-session";
export {
  ADMIN_SESSION_DEFAULT_MS,
  ADMIN_SESSION_REMEMBER_MS,
  ADMIN_IRON_SESSION_TTL_SEC,
  computeAdminSessionExpiresAt,
  getSessionOptions,
  getSessionFromRequest,
  getSession,
  touchAdminSessionFromRequest,
  createSession,
  destroySession,
  isAdminSessionStillValid,
  getAdminSecurityDisplayHints,
} from "./admin-auth-session";
export { getAdminLoginEnvDiagnostics } from "./admin-auth-env";