import { Resend } from "resend";
import { getAdminLoginBaseUrl } from "@/lib/site-url";
import {
  buildAgentRankingEmailHtml,
  emailCard,
  emailCtaButton,
  EMAIL_BRAND_MUTED,
  EMAIL_BRAND_TEXT,
} from "@/lib/email-layout";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM_EMAIL ?? "noreply@agentranking.io";
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
export function getAdminLoginEmail(): string | null {
  return normalizeEnvString(process.env.ADMIN_LOGIN_EMAIL) ?? null;
}
export function getAdminSessionUsername(): string {
  return normalizeEnvString(process.env.ADMIN_USERNAME) ?? "admin";
}
function siteUrl(): string {
  return getAdminLoginBaseUrl();
}
function adminEmailFooter(): string {
  return `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
    AgentRanking Admin — sign-in only. If you did not request this, ignore this email.
  </p>`;
}
export async function sendAdminLoginEmail(input: {
  code: string;
  completeUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const to = getAdminLoginEmail();
  if (!to) {
    return { sent: false, error: "ADMIN_LOGIN_EMAIL not configured" };
  }
  if (!resend) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[admin-email-login] RESEND_API_KEY not set — dev sign-in code:",
        input.code,
        "link:",
        input.completeUrl,
      );
      return { sent: true };
    }
    return { sent: false, error: "Resend not configured" };
  }
  const content = `
    <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;color:${EMAIL_BRAND_TEXT};">
      Admin sign-in
    </h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:15px;margin:0 0 24px;line-height:1.6;">
      Click the button to sign in, or enter the code on the login page. Expires in 5 minutes.
    </p>
    ${emailCard(`
      <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.08em;">Your code</p>
      <p style="color:${EMAIL_BRAND_TEXT};font-size:36px;font-weight:700;letter-spacing:0.35em;margin:0;font-family:ui-monospace,monospace;">${input.code}</p>
    `)}
    ${emailCtaButton("Sign in to Admin", input.completeUrl)}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin-top:20px;">
      Or copy this link:<br/>
      <a href="${input.completeUrl}" style="color:#6400CC;word-break:break-all;">${input.completeUrl}</a>
    </p>
  `;
  try {
    await resend.emails.send({
      from: `AgentRanking <${FROM}>`,
      to,
      subject: "AgentRanking Admin sign-in",
      html: buildAgentRankingEmailHtml({
        content,
        pageTitle: "AgentRanking Admin",
        homeUrl: siteUrl(),
        footerHtml: adminEmailFooter(),
      }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[admin-email-login] sendAdminLoginEmail failed:", err);
    return { sent: false, error: msg };
  }
}