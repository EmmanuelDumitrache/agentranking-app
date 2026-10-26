/** Dev-only hints for admin email login env (no secrets exposed). */
function normalizeEnvString(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  let s = value.trim().replace(/^\uFEFF/, "");
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s.length ? s : undefined;
}
export function getAdminLoginEnvDiagnostics(): {
  loginEmailConfigured: boolean;
  resendConfigured: boolean;
  sessionSecretOk: boolean;
  devHint?: string;
} {
  const loginEmail = normalizeEnvString(process.env.ADMIN_LOGIN_EMAIL);
  const resendKey = normalizeEnvString(process.env.RESEND_API_KEY);
  const secret = normalizeEnvString(process.env.ADMIN_SESSION_SECRET);
  const loginEmailConfigured = Boolean(loginEmail);
  const resendConfigured = Boolean(resendKey);
  const sessionSecretOk = Boolean(secret && secret.length >= 32);
  if (!loginEmailConfigured) {
    return {
      loginEmailConfigured: false,
      resendConfigured,
      sessionSecretOk,
      devHint:
        "Set ADMIN_LOGIN_EMAIL in .env.local (server-only inbox for sign-in codes). Restart the dev server after saving.",
    };
  }
  if (!resendConfigured && process.env.NODE_ENV === "development") {
    return {
      loginEmailConfigured: true,
      resendConfigured: false,
      sessionSecretOk,
      devHint:
        "RESEND_API_KEY not set — sign-in codes are printed in the dev server terminal only.",
    };
  }
  if (!resendConfigured) {
    return {
      loginEmailConfigured: true,
      resendConfigured: false,
      sessionSecretOk,
      devHint: "Set RESEND_API_KEY and RESEND_FROM_EMAIL on the server for email sign-in.",
    };
  }
  if (!sessionSecretOk) {
    return {
      loginEmailConfigured: true,
      resendConfigured: true,
      sessionSecretOk: false,
      devHint:
        "ADMIN_SESSION_SECRET must be at least 32 characters. Generate a cryptographically random value before starting the application.",
    };
  }
  return { loginEmailConfigured: true, resendConfigured: true, sessionSecretOk: true };
}