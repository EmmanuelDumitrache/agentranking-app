import { Resend } from "resend";
import { getDashboardAuthBaseUrl, getDashboardEmailHomeUrl } from "@/lib/dashboard/auth-base-url";
import {
  buildAgentRankingEmailHtml,
  emailCard,
  emailCtaButton,
  emailTag,
  EMAIL_BRAND_MUTED,
  EMAIL_BRAND_TEXT,
} from "@/lib/email-layout";

function resendClient(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return null;
  return new Resend(key);
}

function resendFrom(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "noreply@agentranking.io";
}

function dashboardEmailFooter(): string {
  const dashboardHome = getDashboardEmailHomeUrl();
  return `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
    AgentRanking Agent Dashboard<br/>
    <a href="${dashboardHome}" style="color:${EMAIL_BRAND_TEXT};text-decoration:underline;text-underline-offset:3px;">${dashboardHome}</a><br/>
    <span style="font-size:11px;">If you did not request this, you can ignore this email.</span>
  </p>`;
}

export async function sendDashboardLoginEmail(input: {
  email: string;
  code: string;
  completeUrl: string;
  /** MFA enrollment vs sign-in / challenge copy. */
  purpose?: "sign_in" | "mfa" | "enroll";
}): Promise<{ sent: boolean; error?: string }> {
  const resend = resendClient();
  if (!resend) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[dashboard-email-auth] RESEND_API_KEY not set — dev login code:",
        input.code,
        "link:",
        input.completeUrl,
      );
      return { sent: true };
    }
    return { sent: false, error: "Resend not configured" };
  }

  const purpose = input.purpose ?? "sign_in";
  const title =
    purpose === "enroll"
      ? "Confirm your email"
      : purpose === "mfa"
        ? "Your security code"
        : "Your sign-in code";
  const intro =
    purpose === "enroll"
      ? "Use this code to confirm your inbox and enable email login codes on AgentRanking."
      : purpose === "mfa"
        ? "Use this code to finish verifying it’s you."
        : "Use the code below to sign in to Agent Dashboard. It expires in 20 minutes.";
  const subject =
    purpose === "enroll"
      ? "Confirm your email — AgentRanking"
      : purpose === "mfa"
        ? "Your AgentRanking security code"
        : "Your AgentRanking sign-in code";
  const ctaLabel =
    purpose === "enroll" ? "Open AgentRanking" : purpose === "mfa" ? "Continue sign-in" : "Sign in";

  const content = `
    <p style="margin:0 0 14px;">${emailTag(purpose === "enroll" ? "Email setup" : "Security")}</p>
    <h2 style="font-size:22px;font-weight:700;margin:0 0 10px;color:${EMAIL_BRAND_TEXT};letter-spacing:-0.02em;">${title}</h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:15px;margin:0 0 22px;line-height:1.6;">
      ${intro}
    </p>
    ${emailCard(`
      <p style="color:${EMAIL_BRAND_MUTED};font-size:11px;margin:0 0 10px;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;">One-time code</p>
      <p style="color:${EMAIL_BRAND_TEXT};font-size:34px;font-weight:700;letter-spacing:0.28em;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;">${input.code}</p>
    `)}
    <div style="text-align:center;margin-top:8px;">
      ${emailCtaButton(ctaLabel, input.completeUrl)}
    </div>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:20px 0 0;line-height:1.5;">
      Or open this link:<br/>
      <a href="${input.completeUrl}" style="color:${EMAIL_BRAND_TEXT};word-break:break-all;text-decoration:underline;text-underline-offset:3px;">${input.completeUrl}</a>
    </p>
  `;

  try {
    const result = await resend.emails.send({
      from: `AgentRanking <${resendFrom()}>`,
      to: input.email,
      subject,
      html: buildAgentRankingEmailHtml({
        content,
        pageTitle: "AgentRanking",
        homeUrl: getDashboardEmailHomeUrl(),
        footerHtml: dashboardEmailFooter(),
      }),
    });
    if (result.error) {
      console.error("[dashboard-email-auth] Resend error:", result.error);
      return { sent: false, error: result.error.message };
    }
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[dashboard-email-auth] sendDashboardLoginEmail failed:", err);
    return { sent: false, error: msg };
  }
}

export async function sendDashboardConfirmEmail(input: {
  email: string;
  confirmUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const resend = resendClient();
  if (!resend) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[dashboard-email-auth] RESEND_API_KEY not set — dev confirm link:", input.confirmUrl);
      return { sent: true };
    }
    return { sent: false, error: "Resend not configured" };
  }
  const content = `
    <p style="margin:0 0 14px;">${emailTag("Account")}</p>
    <h2 style="font-size:22px;font-weight:700;margin:0 0 10px;color:${EMAIL_BRAND_TEXT};letter-spacing:-0.02em;">Confirm your email</h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:15px;margin:0 0 22px;line-height:1.6;">
      Confirm your Agent Dashboard account. This link expires in 24 hours.
    </p>
    <div style="text-align:center;">
      ${emailCtaButton("Confirm email", input.confirmUrl)}
    </div>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:20px 0 0;line-height:1.5;">
      Or open this link:<br/>
      <a href="${input.confirmUrl}" style="color:${EMAIL_BRAND_TEXT};word-break:break-all;text-decoration:underline;text-underline-offset:3px;">${input.confirmUrl}</a>
    </p>
  `;
  try {
    const result = await resend.emails.send({
      from: `AgentRanking <${resendFrom()}>`,
      to: input.email,
      subject: "Confirm your AgentRanking account",
      html: buildAgentRankingEmailHtml({
        content,
        pageTitle: "AgentRanking",
        homeUrl: getDashboardEmailHomeUrl(),
        footerHtml: dashboardEmailFooter(),
      }),
    });
    if (result.error) {
      console.error("[dashboard-email-auth] Resend error:", result.error);
      return { sent: false, error: result.error.message };
    }
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[dashboard-email-auth] sendDashboardConfirmEmail failed:", err);
    return { sent: false, error: msg };
  }
}

export async function sendDashboardPasswordResetEmail(input: {
  email: string;
  resetUrl: string;
}): Promise<{ sent: boolean; error?: string }> {
  const resend = resendClient();
  if (!resend) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[dashboard-email-auth] RESEND_API_KEY not set — dev reset link:", input.resetUrl);
      return { sent: true };
    }
    return { sent: false, error: "Resend not configured" };
  }

  const loginUrl = `${getDashboardAuthBaseUrl()}/auth/login`;
  const content = `
    <p style="margin:0 0 14px;">${emailTag("Security")}</p>
    <h2 style="font-size:22px;font-weight:700;margin:0 0 10px;color:${EMAIL_BRAND_TEXT};letter-spacing:-0.02em;">Reset your password</h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:15px;margin:0 0 22px;line-height:1.6;">
      We received a request to reset your Agent Dashboard password. This link expires in 24 hours.
    </p>
    <div style="text-align:center;">
      ${emailCtaButton("Reset password", input.resetUrl)}
    </div>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:20px 0 0;line-height:1.5;">
      Or open this link:<br/>
      <a href="${input.resetUrl}" style="color:${EMAIL_BRAND_TEXT};word-break:break-all;text-decoration:underline;text-underline-offset:3px;">${input.resetUrl}</a>
    </p>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:16px 0 0;line-height:1.5;">
      After resetting, <a href="${loginUrl}" style="color:${EMAIL_BRAND_TEXT};text-decoration:underline;text-underline-offset:3px;">return to sign in</a>.
    </p>
  `;

  try {
    const result = await resend.emails.send({
      from: `AgentRanking <${resendFrom()}>`,
      to: input.email,
      subject: "Reset your AgentRanking password",
      html: buildAgentRankingEmailHtml({
        content,
        pageTitle: "AgentRanking",
        homeUrl: getDashboardEmailHomeUrl(),
        footerHtml: dashboardEmailFooter(),
      }),
    });
    if (result.error) {
      console.error("[dashboard-email-auth] Resend error:", result.error);
      return { sent: false, error: result.error.message };
    }
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[dashboard-email-auth] sendDashboardPasswordResetEmail failed:", err);
    return { sent: false, error: msg };
  }
}
