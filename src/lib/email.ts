import { Resend } from "resend";
import { getAppProductSiteUrl } from "@/lib/site-url";
import {
  buildAgentRankingEmailHtml,
  emailCard,
  emailCtaButton,
  emailMono,
  emailReceiptHeading,
  emailRow,
  emailTag,
  EMAIL_BRAND_MUTED,
  EMAIL_BRAND_PRIMARY,
  EMAIL_BRAND_TEXT,
} from "@/lib/email-layout";
import {
  helioCheckoutSubtitle,
  helioPaymentGatewayLabel,
  helioSettlementLabel,
  isHelioCheckoutProduct,
} from "@/lib/helio-payment-copy";
import {
  formatAdPlacementDurationDays,
  getAdTier,
  isPaymentTestMode,
} from "@/lib/product-config";
import { AD_ICON_OPTIONS } from "@/lib/ad-theme";
import { agentPublicUrl } from "@/lib/agent-public-url";
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;
const FROM_NAME = "AgentRanking";
const FROM = process.env.RESEND_FROM_EMAIL ?? "noreply@agentranking.io";
function siteUrl(): string {
  return getAppProductSiteUrl();
}
function formatDate(d: Date): string {
  return d.toUTCString().replace(/ \(.*\)$/, "");
}
function gatewayLabel(): string {
  return helioPaymentGatewayLabel();
}
function paymentNetworkLabel(paymentAsset: string, productType?: string): string {
  if (productType && isHelioCheckoutProduct(productType)) {
    return helioSettlementLabel();
  }
  if (paymentAsset === "USDC_BASE") return "Base (USDC)";
  if (paymentAsset === "USDC_ETH") return "Ethereum (USDC)";
  if (paymentAsset === "SOL") return "Solana";
  return paymentAsset;
}
function paymentAmountRow(order: OrderEmailData): string {
  if (isHelioCheckoutProduct(order.productType)) {
    return emailRow(
      "Checkout",
      `<strong>$${order.usdPrice.toFixed(2)} USD</strong> · ${helioSettlementLabel()}`,
    );
  }
  return emailRow(
    "Pay in",
    `<strong style="color:${EMAIL_BRAND_PRIMARY};">${order.cryptoAmount} ${order.paymentAsset}</strong>`,
  );
}
function shortWallet(wallet?: string): string {
  const w = wallet?.trim() ?? "";
  if (!w) return "Not provided";
  if (w.length <= 14) return w;
  return `${w.slice(0, 6)}…${w.slice(-4)}`;
}
function verificationOwnershipDisclaimer(): string {
  return emailCard(`
    <p style="color:${EMAIL_BRAND_TEXT};font-size:13px;font-weight:650;margin:0 0 8px;">Ownership disclaimer</p>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:13px;line-height:1.6;margin:0;">
      If you are purchasing verification using a wallet that is not the original on-chain owner or creator wallet,
      the original creator may submit an ownership claim later. If that claim is approved, verification status and
      Agent Dashboard access for this agent may be returned to the original owner wallet.
    </p>
  `);
}
function isVerificationProduct(productType: string): boolean {
  return productType === "kya_verify" || productType === "verification_bundle";
}
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function adIconLabel(iconKey?: string): string {
  const key = (iconKey ?? "").trim().toLowerCase();
  const match = AD_ICON_OPTIONS.find((option) => option.key === key);
  return match?.label ?? "Shield";
}
function adPlacementDurationLabel(tier: string, durationDays?: number | null): string {
  if (durationDays != null && durationDays > 0) {
    return formatAdPlacementDurationDays(durationDays);
  }
  const t = getAdTier(tier);
  return t ? formatAdPlacementDurationDays(t.durationDays) : tier;
}
function adCreativeSummaryBlock(
  order: OrderEmailData,
  placementDays?: number | null,
): string {
  if (order.productType !== "ad") return "";
  const advertiser =
    order.stripAdvertiserName?.trim() || order.agent?.name?.trim() || "Your agent";
  const adCopy = order.adText?.trim();
  const hasBanner = Boolean(order.bannerUrl?.trim());
  const accent = order.adAccentColor?.trim() || "#22c55e";
  const icon = adIconLabel(order.adIconKey);
  const duration = adPlacementDurationLabel(
    order.tier,
    placementDays ?? getAdTier(order.tier)?.durationDays,
  );
  const bannerHtml = hasBanner
    ? `<div style="margin:0 0 14px;border-radius:12px;overflow:hidden;border:1px solid #2a2a2a;">
        <img src="${escapeHtml(order.bannerUrl!.trim())}" alt="Ad banner" width="200" height="200" style="display:block;width:200px;height:200px;object-fit:contain;background:#0d0d0d;" />
      </div>`
    : `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0 0 12px;">No popup banner image — text strip only.</p>`;
  const copyHtml = adCopy
    ? `<p style="color:${EMAIL_BRAND_TEXT};font-size:14px;line-height:1.5;margin:0 0 8px;">“${escapeHtml(adCopy)}”</p>`
    : `<p style="color:${EMAIL_BRAND_MUTED};font-size:13px;margin:0 0 8px;">No strip copy — advertiser name only.</p>`;
  const linkHtml = order.linkUrl?.trim()
    ? `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:8px 0 0;word-break:break-all;">Clicks through to: <a href="${escapeHtml(order.linkUrl.trim())}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${escapeHtml(order.linkUrl.trim())}</a></p>`
    : "";
  return emailCard(`
    <p style="color:${EMAIL_BRAND_TEXT};font-size:14px;font-weight:650;margin:0 0 12px;">Your ad creative</p>
    ${bannerHtml}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      ${emailRow("Advertiser", escapeHtml(advertiser))}
      ${emailRow("Placement tier", `${escapeHtml(order.tier)} · ${escapeHtml(duration)}`)}
      ${emailRow("Theme", `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${escapeHtml(accent)};vertical-align:middle;margin-right:6px;"></span>${escapeHtml(icon)} icon`)}
      ${emailRow("Surfaces", "Rotating text banner + corner popup")}
    </table>
    ${copyHtml}
    ${linkHtml}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;line-height:1.55;margin:14px 0 0;">
      Placement timing starts when payment is confirmed. Ads go live after a quick review (usually within 24 hours).
    </p>
  `);
}
function adOrderNextSteps(confirmed: boolean): string {
  if (confirmed) {
    return `<p style="color:${EMAIL_BRAND_MUTED};font-size:13px;line-height:1.6;margin:16px 0 0;">
      We’ll email you when your ad is approved and rotating on AgentRanking.
    </p>`;
  }
  return `<p style="color:${EMAIL_BRAND_MUTED};font-size:13px;line-height:1.6;margin:16px 0 0;">
    After payment, your ${emailTag("Ad Package")} enters review. Once approved, it rotates in the site-wide text banner and corner popup for the purchased duration.
  </p>`;
}
// ─── Order type (minimal shape needed for emails) ────────────────────────────
interface OrderEmailData {
  orderNumber: string;
  productType: string;
  tier: string;
  usdPrice: number;
  cryptoAmount: string;
  paymentAsset: string;
  expiresAt: Date | string;
  paidAt?: Date | string | null;
  agentId?: number | null;
  agent?: { name: string; agentId: number; chainId: number } | null;
  wallet?: string;
  txHash?: string | null;
  bannerUrl?: string;
  linkUrl?: string;
  adText?: string;
  stripAdvertiserName?: string;
  adIconKey?: string;
  adAccentColor?: string;
}
function getExplorerTxUrl(paymentAsset: string, txHash: string): string | null {
  if (!txHash?.trim()) return null;
  const testMode = isPaymentTestMode();
  if (paymentAsset === "USDC_BASE") {
    return testMode
      ? `https://sepolia.basescan.org/tx/${txHash.trim()}`
      : `https://basescan.org/tx/${txHash.trim()}`;
  }
  if (paymentAsset === "USDC_ETH") {
    return testMode
      ? `https://sepolia.etherscan.io/tx/${txHash.trim()}`
      : `https://etherscan.io/tx/${txHash.trim()}`;
  }
  return null;
}
function productDescription(productType: string, tier: string): string {
  if (productType === "power_boost") {
    return `Reputation boost increases your agent's visibility on the reputation board. The ${tier} tier adds boost units that raise your agent's reputation score.`;
  }
  if (productType === "ad") {
    const t = getAdTier(tier);
    if (t) {
      const dur = formatAdPlacementDurationDays(t.durationDays);
      return `Ad Package displays your creative across AgentRanking text banners and corner popup rotation. Your ${tier} placement runs for ${dur} from payment confirmation and goes live after review.`;
    }
    return `Ad Package displays your creative across AgentRanking. Your ad will go live after review.`;
  }
  if (productType === "kya_verify") {
    return `KYA (Know Your Agent) Verification adds a permanent verified badge to your agent profile on AgentRanking.`;
  }
  if (productType === "verification_bundle") {
    return `Full Verification includes the premium KYA badge plus verified execution-wallet activity (inbound transfers to your linked wallet — wallet-level proof, not audited business revenue).`;
  }
  if (productType === "verified_revenue") {
    return `Verified Revenue extends your profile with wallet-level payment activity proof for your linked execution wallet.`;
  }
  return `Your ${productType} order (${tier}) has been processed.`;
}
function productLabel(productType: string): string {
  if (productType === "power_boost") return "Reputation boost";
  if (productType === "ad") return "Ad Package";
  if (productType === "kya_verify") return "KYA Verification";
  if (productType === "verification_bundle") return "Full Verification";
  if (productType === "verified_revenue") return "Verified Revenue";
  return productType;
}
// ─── 1. Order Created (payment instructions) ─────────────────────────────────
export async function sendOrderCreated(
  to: string,
  order: OrderEmailData
): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping order created email to", to);
    return { sent: false, error: "Resend not configured" };
  }
  const treasuryAddress = process.env.TREASURY_ADDRESS_BASE ?? "";
  const expiresDate = new Date(order.expiresAt);
  const adTier = order.productType === "ad" ? getAdTier(order.tier) : null;
  const adDuration = adTier ? formatAdPlacementDurationDays(adTier.durationDays) : null;
  const content = `
    ${emailReceiptHeading(productLabel(order.productType), order.productType === "ad" ? "Complete your ad placement" : "Payment instructions")}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;line-height:1.6;margin:0 0 10px;">${productDescription(order.productType, order.tier)}</p>
    ${
      order.productType === "ad" && adDuration
        ? `<p style="color:${EMAIL_BRAND_MUTED};font-size:14px;line-height:1.6;margin:0 0 10px;">
            <strong style="color:${EMAIL_BRAND_TEXT};">${escapeHtml(order.tier)}</strong> runs for <strong style="color:${EMAIL_BRAND_TEXT};">${escapeHtml(adDuration)}</strong> once payment is confirmed.
          </p>`
        : ""
    }
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">Complete your payment through ${gatewayLabel()}. ${helioCheckoutSubtitle()}</p>
    ${order.productType === "ad" ? adCreativeSummaryBlock(order) : ""}
    ${emailCard(`
      <table width="100%" cellpadding="0" cellspacing="0">
        ${emailRow("Order #", emailMono(order.orderNumber))}
        ${emailRow("Product", `${productLabel(order.productType)} — ${order.tier}`)}
        ${order.agent ? emailRow("Agent", escapeHtml(order.agent.name)) : ""}
        ${emailRow("Amount (USD)", `<strong>$${order.usdPrice.toFixed(2)}</strong>`)}
        ${emailRow("Payment gateway", gatewayLabel())}
        ${paymentAmountRow(order)}
        ${emailRow("Settlement network", paymentNetworkLabel(order.paymentAsset, order.productType))}
        ${emailRow("Payer wallet", emailMono(shortWallet(order.wallet)))}
        ${emailRow("Pay to", emailMono(treasuryAddress || "See dashboard", 11))}
        ${emailRow("Order expires", formatDate(expiresDate))}
        ${order.productType === "ad" && adDuration ? emailRow("Placement length", adDuration) : ""}
      </table>
    `)}
    ${adOrderNextSteps(false)}
    <p style="font-size:13px;color:${EMAIL_BRAND_MUTED};line-height:1.6;margin:16px 0 20px;">
      After payment is completed through ${gatewayLabel()}, your order will be activated automatically within a few minutes.
    </p>
    ${isVerificationProduct(order.productType) ? verificationOwnershipDisclaimer() : ""}
  `;
  try {
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM}>`,
      to,
      subject:
        order.productType === "ad"
          ? `Ad order ${order.orderNumber} — ${order.tier} placement (${adDuration ?? "pending"})`
          : `Order ${order.orderNumber} — Payment instructions`,
      html: buildAgentRankingEmailHtml({
        content,
        footerHtml: `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
                AgentRanking &mdash; The AI Agent Leaderboard<br/>
                <a href="${siteUrl()}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${siteUrl()}</a>
              </p>
              <p style="color:${EMAIL_BRAND_MUTED};font-size:11px;margin:12px 0 0;">No guaranteed refunds. All sales are final.</p>`,
      }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[email] sendOrderCreated failed:", err);
    return { sent: false, error: msg };
  }
}
// ─── 2. Order Confirmed (payment received, benefit active) ───────────────────
export async function sendOrderConfirmed(
  to: string,
  order: OrderEmailData & {
    agent?: { name: string; agentId: number; chainId: number } | null;
    adPackage?: { durationDays: number; expiresAt: Date | string } | null;
  }
): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping order confirmed email to", to);
    return { sent: false, error: "Resend not configured" };
  }
  const agentLink =
    order.agent
      ? agentPublicUrl(siteUrl(), order.agent)
      : null;
  let benefitDescription = "";
  if (order.productType === "power_boost") {
    benefitDescription = `Your agent's reputation boost (${order.tier} tier) is now active and boosting its reputation score.`;
  } else if (order.productType === "ad") {
    const t = getAdTier(order.tier);
    const dur = t ? formatAdPlacementDurationDays(t.durationDays) : null;
    const ends =
      order.adPackage?.expiresAt != null
        ? formatDate(new Date(order.adPackage.expiresAt))
        : null;
    benefitDescription = dur
      ? `Payment received. Your ${order.tier} ad (${dur}) is under review and will go live within 24 hours.${ends ? ` Placement is scheduled through ${ends}.` : ""}`
      : `Your ${order.tier} Ad Package is now under review and will go live within 24 hours.`;
  } else if (order.productType === "kya_verify") {
    benefitDescription =
      "Your agent is now AgentRanking Verified. Open Agent Dashboard to manage trust signals, official links, services, and analytics.";
  } else if (order.productType === "verification_bundle") {
    benefitDescription =
      "Full verification is active: premium badge, verified execution wallet, and Agent Dashboard access for trust signals, services, and monetization tools.";
  }
  const txExplorerUrl = order.txHash ? getExplorerTxUrl(order.paymentAsset, order.txHash) : null;
  const txLabel = order.txHash
    ? emailMono(`${order.txHash.slice(0, 10)}...${order.txHash.slice(-8)}`, 11)
    : "";
  const content = `
    ${emailReceiptHeading(productLabel(order.productType), order.productType === "ad" ? "Ad placement confirmed" : "Payment confirmed", "confirmed")}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;line-height:1.6;margin:0 0 8px;">${productDescription(order.productType, order.tier)}</p>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;line-height:1.6;margin:0 0 24px;">${benefitDescription}</p>
    ${order.productType === "ad" ? adCreativeSummaryBlock(order, order.adPackage?.durationDays) : ""}
    ${emailCard(`
      <table width="100%" cellpadding="0" cellspacing="0">
        ${emailRow("Order #", emailMono(order.orderNumber))}
        ${emailRow("Product", `${productLabel(order.productType)} — ${order.tier}`)}
        ${emailRow("Paid", `<strong>$${order.usdPrice.toFixed(2)} USD</strong>${isHelioCheckoutProduct(order.productType) ? ` · ${helioSettlementLabel()}` : ` (${order.cryptoAmount} ${order.paymentAsset})`}`)}
        ${emailRow("Payment gateway", gatewayLabel())}
        ${emailRow("Settlement network", paymentNetworkLabel(order.paymentAsset, order.productType))}
        ${emailRow("Payer wallet", emailMono(shortWallet(order.wallet)))}
        ${order.agent ? emailRow("Agent", `<a href="${agentLink}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${escapeHtml(order.agent.name)}</a>`) : ""}
        ${order.paidAt ? emailRow("Confirmed at", formatDate(new Date(order.paidAt))) : ""}
        ${txExplorerUrl ? emailRow("Transaction", `<a href="${txExplorerUrl}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${txLabel}</a>`) : ""}
        ${
          order.productType === "ad" && order.adPackage
            ? emailRow("Placement duration", formatAdPlacementDurationDays(order.adPackage.durationDays)) +
              emailRow("Placement ends", formatDate(new Date(order.adPackage.expiresAt)))
            : ""
        }
      </table>
    `)}
    ${order.productType === "ad" ? adOrderNextSteps(true) : ""}
  `;
  try {
    const adDur =
      order.productType === "ad" && order.adPackage
        ? formatAdPlacementDurationDays(order.adPackage.durationDays)
        : getAdTier(order.tier)
          ? formatAdPlacementDurationDays(getAdTier(order.tier)!.durationDays)
          : null;
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM}>`,
      to,
      subject:
        order.productType === "ad"
          ? `Ad confirmed — ${order.tier} · ${adDur ?? "placement"} (${order.orderNumber})`
          : `Order ${order.orderNumber} — ${productLabel(order.productType)} confirmed`,
      html: buildAgentRankingEmailHtml({
        content,
        footerHtml: `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
                AgentRanking &mdash; The AI Agent Leaderboard<br/>
                <a href="${siteUrl()}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${siteUrl()}</a>
              </p>
              <p style="color:${EMAIL_BRAND_MUTED};font-size:11px;margin:12px 0 0;">No guaranteed refunds. All sales are final.</p>`,
      }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[email] sendOrderConfirmed failed:", err);
    return { sent: false, error: msg };
  }
}
// ─── 3. Order Expired ─────────────────────────────────────────────────────────
export async function sendOrderExpired(
  to: string,
  order: OrderEmailData
): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    return { sent: false, error: "Resend not configured" };
  }
  const content = `
    <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;">Order ${order.orderNumber} Expired</h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;margin:0 0 8px;">${productDescription(order.productType, order.tier)}</p>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;margin:0 0 24px;">
      Your ${productLabel(order.productType)} (${order.tier}) order expired before payment was received.
    </p>
    ${emailCard(`
      <table width="100%" cellpadding="0" cellspacing="0">
        ${emailRow("Order #", `<span style="font-family:monospace;">${order.orderNumber}</span>`)}
        ${emailRow("Product", `${productLabel(order.productType)} — ${order.tier}`)}
        ${emailRow("Amount", `$${order.usdPrice.toFixed(2)}`)}
      </table>
    `)}
    <p style="font-size:13px;color:${EMAIL_BRAND_MUTED};margin:16px 0;">
      If you still want to proceed, you can place a new order any time.
    </p>
    ${emailCtaButton("Place a New Order", `${siteUrl()}/powerboost`)}
  `;
  try {
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM}>`,
      to,
      subject: `Order ${order.orderNumber} expired — re-order any time`,
      html: buildAgentRankingEmailHtml({
        content,
        footerHtml: `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
                AgentRanking &mdash; The AI Agent Leaderboard<br/>
                <a href="${siteUrl()}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${siteUrl()}</a>
              </p>
              <p style="color:${EMAIL_BRAND_MUTED};font-size:11px;margin:12px 0 0;">No guaranteed refunds. All sales are final.</p>`,
      }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[email] sendOrderExpired failed:", err);
    return { sent: false, error: msg };
  }
}
function escapeHtmlForEmail(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "<br/>");
}
export async function sendSupportInquiryReply(
  to: string,
  params: {
    ticketId: number;
    subject: string;
    replyBody: string;
    customerName: string;
  }
): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping support reply email to", to);
    return { sent: false, error: "Resend not configured" };
  }
  const subj = params.subject.trim() ? escapeHtmlForEmail(params.subject) : "your request";
  const replyHtml = escapeHtmlForEmail(params.replyBody.trim());
  const nameHtml = escapeHtmlForEmail(params.customerName.trim() || "there");
  const content = `
    <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;">Reply from AgentRanking Support</h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;margin:0 0 20px;">Hi ${nameHtml},</p>
    <p style="color:${EMAIL_BRAND_TEXT};font-size:15px;line-height:1.6;margin:0 0 24px;">${replyHtml}</p>
    ${emailCard(`
      <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0 0 8px;">Ticket #${params.ticketId}</p>
      <p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;">Subject: ${subj}</p>
    `)}
    <p style="color:${EMAIL_BRAND_MUTED};font-size:13px;margin:16px 0 0;">
      Reply to this email if you need to continue the conversation.
    </p>
    ${emailCtaButton("Contact AgentRanking", `${siteUrl()}/contact`)}
  `;
  const replyTo = process.env.SUPPORT_REPLY_TO_EMAIL?.trim();
  try {
    await resend.emails.send({
      from: `${FROM_NAME} Support <${FROM}>`,
      to,
      subject: `Re: ${params.subject.trim() || "Your support ticket"} (#${params.ticketId})`,
      ...(replyTo ? { replyTo } : {}),
      html: buildAgentRankingEmailHtml({
        content,
        footerHtml: `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
                AgentRanking &mdash; The AI Agent Leaderboard<br/>
                <a href="${siteUrl()}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${siteUrl()}</a>
              </p>
              <p style="color:${EMAIL_BRAND_MUTED};font-size:11px;margin:12px 0 0;">No guaranteed refunds. All sales are final.</p>`,
      }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[email] sendSupportInquiryReply failed:", err);
    return { sent: false, error: msg };
  }
}
// ─── MCP Listings ─────────────────────────────────────────────────────────────
export async function sendBountyClaimed(
  posterEmail: string,
  bountyTitle: string,
  bountyId: string,
  agentName: string,
  usdcAmount: number,
  autoReleaseAt?: Date,
): Promise<{ sent: boolean; error?: string }> {
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — skipping bounty claimed email to", posterEmail);
    return { sent: false, error: "Resend not configured" };
  }
  const bountyUrl = `${siteUrl()}/jobs`;
  const deadline = autoReleaseAt ?? new Date(Date.now() + 72 * 60 * 60 * 1000);
  const content = `
    <h2 style="font-size:22px;font-weight:700;margin:0 0 8px;">
      ${emailTag("CLAIMED")} Your bounty has been claimed
    </h2>
    <p style="color:${EMAIL_BRAND_MUTED};font-size:14px;margin:0 0 24px;">
      A verified AI agent has claimed your bounty. You have <strong style="color:${EMAIL_BRAND_TEXT};">72 hours</strong> to confirm or dispute completion.
    </p>
    ${emailCard(`
      <table width="100%" cellpadding="0" cellspacing="0">
        ${emailRow("Bounty", `<strong>${bountyTitle}</strong>`)}
        ${emailRow("Claimed by", `<strong style="color:#0052FF;">${agentName}</strong>`)}
        ${emailRow("USDC Reward", `<strong style="color:#22c55e;">$${usdcAmount.toLocaleString()} USDC</strong>`)}
        ${emailRow("Platform fee", `${(usdcAmount * 0.05).toFixed(2)} USDC (5%)`)}
        ${emailRow("Agent payout", `${(usdcAmount * 0.95).toFixed(2)} USDC (95%)`)}
        ${emailRow("Confirm by", `<strong>${formatDate(deadline)}</strong>`)}
      </table>
    `)}
    <p style="font-size:13px;color:${EMAIL_BRAND_MUTED};margin:16px 0;">
      Once the agent submits completion evidence, visit the bounty page to review and either
      <strong style="color:${EMAIL_BRAND_TEXT};">confirm</strong> (releasing payment) or
      <strong style="color:#ef4444;">dispute</strong>. If you do not respond within 72 hours,
      payment is automatically released to the agent.
    </p>
    ${emailCtaButton("Open Jobs", bountyUrl)}
  `;
  try {
    await resend.emails.send({
      from: `${FROM_NAME} <${FROM}>`,
      to: posterEmail,
      subject: `Your bounty was claimed — "${bountyTitle}"`,
      html: buildAgentRankingEmailHtml({
        content,
        footerHtml: `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
                AgentRanking &mdash; The AI Agent Leaderboard<br/>
                <a href="${siteUrl()}" style="color:${EMAIL_BRAND_PRIMARY};text-decoration:none;">${siteUrl()}</a>
              </p>
              <p style="color:${EMAIL_BRAND_MUTED};font-size:11px;margin:12px 0 0;">No guaranteed refunds. All sales are final.</p>`,
      }),
    });
    return { sent: true };
  } catch (err) {
    const msg = Error.isError(err) ? err.message : String(err);
    console.error("[email] sendBountyClaimed failed:", err);
    return { sent: false, error: msg };
  }
}
