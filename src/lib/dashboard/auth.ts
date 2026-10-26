import { randomUUID } from "node:crypto";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { classifyWallet } from "@/lib/trust-oracle-logic";
import { appAbsoluteUrl, getDashboardHomeUrl } from "@/lib/site-url";
import {
  buildAgentRankingEmailHtml,
  emailCard,
  emailCtaButton,
  EMAIL_BRAND_MUTED,
  EMAIL_BRAND_PRIMARY,
  EMAIL_BRAND_TEXT,
} from "@/lib/email-layout";
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM_EMAIL ?? "noreply@agentranking.io";
const DASHBOARD_HOME = getDashboardHomeUrl();
interface OrderForAccount {
  id: string;
  email: string;
  wallet: string;
  agentId: number | null;
  productType: string;
}
/**
 * Called after a kya_verify order activates.
 * Idempotently provisions a UserProfile and a reusable, unexpired claim token.
 * Delivery is queued separately through the durable NotificationDelivery pipeline.
 */
export async function createDashboardAccount(order: OrderForAccount): Promise<{ profileId: number }> {
  if (!order.email) throw new Error("Dashboard account provisioning requires an email");
  const existing = await prisma.userProfile.findUnique({ where: { email: order.email } });
  const hasUsableClaimToken = Boolean(
    existing?.claimToken &&
    existing.claimTokenExpiresAt &&
    existing.claimTokenExpiresAt > new Date(),
  );
  const claimToken = hasUsableClaimToken ? existing!.claimToken! : randomUUID();
  const claimTokenExpiresAt = hasUsableClaimToken
    ? existing!.claimTokenExpiresAt!
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const rawWallet = order.wallet.trim();
  const walletKind = classifyWallet(rawWallet);
  const wallet = walletKind === "evm" ? rawWallet.toLowerCase() : rawWallet;
  const walletData = !walletKind
    ? {}
    : walletKind === "solana"
      ? { walletAddress: wallet, solanaWallet: wallet }
      : { walletAddress: wallet };
  const profile = existing
    ? await prisma.userProfile.update({
        where: { email: order.email },
        data: {
          claimToken,
          claimTokenExpiresAt,
          subscriptionStatus: existing.subscriptionStatus === "active" ? "active" : "pending",
          ...(!existing.walletAddress ? walletData : {}),
        },
        select: { id: true },
      })
    : await prisma.userProfile.create({
        data: {
          email: order.email,
          ...walletData,
          claimToken,
          claimTokenExpiresAt,
          subscriptionStatus: "pending",
        },
        select: { id: true },
      });
  return { profileId: profile.id };
}
/**
 * Send the one-time claim email with a link to set a password and access the dashboard.
 */
export async function sendClaimEmail(to: string, token: string): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    console.warn("[dashboard-auth] RESEND_API_KEY not set — skipping claim email to", to);
    return { sent: false, error: "Resend not configured" };
  }
  const claimUrl = appAbsoluteUrl(`/dashboard/auth/claim?token=${encodeURIComponent(token)}`);
  const dashboardUrl = DASHBOARD_HOME;
  const content = `
    <h2 style="font-size:24px;font-weight:700;margin:0 0 8px;color:${EMAIL_BRAND_TEXT};">
      Your Agent Dashboard is Ready
    </h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:15px;margin:0 0 24px;line-height:1.6;">
      Your verification is confirmed. Agent Dashboard is unlocked — manage trust signals, official links,
      services, x402 readiness, analytics, and AR Score improvements for your verified agents.
    </p>
    ${emailCard(`
      <p style="color:${EMAIL_BRAND_MUTED};font-size:13px;margin:0 0 8px;">What's inside Agent Dashboard:</p>
      <ul style="color:${EMAIL_BRAND_TEXT};font-size:14px;line-height:2;margin:0;padding-left:20px;">
        <li>Verification manager &amp; trust summary</li>
        <li>Official links lock</li>
        <li>Services &amp; endpoint health checks</li>
        <li>x402 readiness &amp; paid service registry</li>
        <li>Analytics &amp; AR Score improvement checklist</li>
      </ul>
    `)}
    ${emailCtaButton("Open Agent Dashboard", dashboardUrl)}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:13px;margin:16px 0 4px;">
      Prefer email/password access? Claim your account below (expires in 30 days).
    </p>
    ${emailCtaButton("Claim Dashboard Access", claimUrl)}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin-top:20px;">
      Or copy this link:<br/>
      <a href="${claimUrl}" style="color:${EMAIL_BRAND_PRIMARY};word-break:break-all;">${claimUrl}</a>
    </p>
  `;
  try {
    await resend.emails.send({
      from: `AgentRanking <${FROM}>`,
      to,
      subject: "Your AgentRanking Dashboard — Claim your access",
      html: buildAgentRankingEmailHtml({ content, pageTitle: "Agent Dashboard" }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[dashboard-auth] sendClaimEmail failed:", err);
    return { sent: false, error: msg };
  }
}
/**
 * Send subscription renewal reminder email (7d before expiry).
 */
export async function sendSubscriptionReminderEmail(
  to: string,
  expiresAt: Date,
  helioPayLink: string
): Promise<{ sent: boolean; error?: string }> {
  if (!resend) return { sent: false, error: "Resend not configured" };
  const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const content = `
    <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;color:${EMAIL_BRAND_TEXT};">
      Your subscription expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}
    </h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;margin:0 0 24px;line-height:1.6;">
      Renew now to keep access to your AgentRanking subscriber dashboard — agent management,
      widgets, MCP tools, and priority support.
    </p>
    ${emailCtaButton("Renew Subscription", helioPayLink)}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin-top:20px;">
      Or visit Dashboard: <a href="${DASHBOARD_HOME}" style="color:${EMAIL_BRAND_PRIMARY};">${DASHBOARD_HOME}</a>
    </p>
  `;
  try {
    await resend.emails.send({
      from: `AgentRanking <${FROM}>`,
      to,
      subject: `Your AgentRanking subscription expires in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`,
      html: buildAgentRankingEmailHtml({ content }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[dashboard-auth] sendSubscriptionReminderEmail failed:", err);
    return { sent: false, error: msg };
  }
}
/**
 * Send subscription lapsed (expired) email.
 */
export async function sendSubscriptionLapsedEmail(
  to: string,
  helioPayLink: string
): Promise<{ sent: boolean; error?: string }> {
  if (!resend) return { sent: false, error: "Resend not configured" };
  const content = `
    <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;color:${EMAIL_BRAND_TEXT};">
      Your subscription has expired
    </h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;margin:0 0 24px;line-height:1.6;">
      Your AgentRanking subscriber access has lapsed. Renew to regain full access to
      your dashboard, agent tools, and priority support.
    </p>
    ${emailCtaButton("Renew for $39 / month", helioPayLink)}
  `;
  try {
    await resend.emails.send({
      from: `AgentRanking <${FROM}>`,
      to,
      subject: "Your AgentRanking subscription has expired — renew now",
      html: buildAgentRankingEmailHtml({ content }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[dashboard-auth] sendSubscriptionLapsedEmail failed:", err);
    return { sent: false, error: msg };
  }
}
