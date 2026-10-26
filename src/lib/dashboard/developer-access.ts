import { normalizeDashboardEmail } from "@/lib/dashboard/auth-users";

let cachedDeveloperEmails: ReadonlySet<string> | null = null;

/** Comma-separated allowlist — e.g. `you@company.com,teammate@company.com` */
export function getDeveloperAccountEmails(): ReadonlySet<string> {
  if (cachedDeveloperEmails) return cachedDeveloperEmails;
  const raw = process.env.DEVELOPER_ACCOUNT_EMAILS ?? "";
  cachedDeveloperEmails = new Set(
    raw
      .split(",")
      .map((entry) => normalizeDashboardEmail(entry))
      .filter(Boolean),
  );
  return cachedDeveloperEmails;
}

export function isDeveloperAccountEmail(email: string | null | undefined): boolean {
  if (!email?.trim()) return false;
  const normalized = normalizeDashboardEmail(email);
  if (!normalized || normalized.includes("@wallet.agentranking.io")) return false;
  return getDeveloperAccountEmails().has(normalized);
}

/** Developer allowlist — same rules in local dev and production. */
export function isDeveloperDevToolsActive(accountEmail?: string | null): boolean {
  return isDeveloperAccountEmail(accountEmail);
}
