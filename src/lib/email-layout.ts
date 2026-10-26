import { getAppProductSiteUrl } from "@/lib/site-url";
/** Shared dark-mode transactional email chrome (matches dashboard zinc UI). */
export const EMAIL_BRAND_BG = "#09090b";
export const EMAIL_BRAND_CARD = "#18181b";
export const EMAIL_BRAND_TEXT = "#fafafa";
export const EMAIL_BRAND_MUTED = "#a1a1aa";
export const EMAIL_BRAND_PRIMARY = "#fafafa";
export const EMAIL_BRAND_ACCENT = "#34d399";
export const EMAIL_BORDER = "rgba(255,255,255,0.10)";

/** Absolute logo URL that email clients can fetch (never localhost). */
export function resolveEmailLogoUrl(): string {
  const configured = process.env.EMAIL_LOGO_URL?.trim();
  if (configured) return configured;
  // Prefer production CDN so local/dev sends still render the mark in inboxes.
  return "https://app.agentranking.io/ar-mark.png";
}

export type AgentRankingEmailOptions = {
  content: string;
  pageTitle?: string;
  homeUrl?: string;
  footerHtml?: string;
};

export function buildAgentRankingEmailHtml(options: AgentRankingEmailOptions): string {
  const home = options.homeUrl ?? getAppProductSiteUrl();
  const logo = resolveEmailLogoUrl();
  const pageTitle = options.pageTitle ?? "AgentRanking";
  const footerHtml =
    options.footerHtml ??
    `<p style="color:${EMAIL_BRAND_MUTED};font-size:12px;margin:0;line-height:1.5;">
      AgentRanking &mdash; The AI Agent Leaderboard<br/>
      <a href="${home}" style="color:${EMAIL_BRAND_TEXT};text-decoration:underline;text-underline-offset:3px;">${home}</a>
    </p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${pageTitle}</title>
</head>
<body style="margin:0;padding:0;background:${EMAIL_BRAND_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${EMAIL_BRAND_TEXT};">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:${EMAIL_BRAND_BG};padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" role="presentation" style="max-width:560px;width:100%;background:${EMAIL_BRAND_CARD};border:1px solid ${EMAIL_BORDER};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 20px;text-align:center;border-bottom:1px solid ${EMAIL_BORDER};">
              <a href="${home}" style="text-decoration:none;display:inline-block;">
                <img src="${logo}" alt="AgentRanking" height="36" style="display:block;margin:0 auto;height:36px;width:auto;border:0;" />
              </a>
              <p style="margin:12px 0 0;font-size:13px;font-weight:600;letter-spacing:0.02em;color:${EMAIL_BRAND_TEXT};">AgentRanking</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${options.content}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;border-top:1px solid ${EMAIL_BORDER};">
              <div style="padding-top:20px;">
                ${footerHtml}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function emailCard(inner: string): string {
  return `<div style="background:#09090b;border:1px solid ${EMAIL_BORDER};border-radius:12px;padding:22px;margin:0 0 18px;">${inner}</div>`;
}

export function emailTag(label: string): string {
  return `<span style="background:rgba(52,211,153,0.12);color:${EMAIL_BRAND_ACCENT};border:1px solid rgba(52,211,153,0.28);border-radius:6px;padding:3px 10px;font-size:12px;font-weight:600;">${label}</span>`;
}

export function emailCtaButton(text: string, href: string, darkText = true): string {
  const fg = darkText ? "#09090b" : "#ffffff";
  return `<a href="${href}" style="display:inline-block;background:${EMAIL_BRAND_PRIMARY};color:${fg};text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px;margin-top:8px;">${text}</a>`;
}

export function emailRow(label: string, value: string): string {
  return `<tr>
    <td style="color:${EMAIL_BRAND_MUTED};font-size:13px;padding:8px 0;width:150px;vertical-align:top;">${label}</td>
    <td style="color:${EMAIL_BRAND_TEXT};font-size:13px;padding:8px 0;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`;
}

export function emailReceiptHeading(label: string, title: string, status?: string): string {
  const statusHtml = status
    ? `<span style="color:#22c55e;font-size:20px;line-height:1;">✓</span> `
    : "";
  return `
    <div style="margin:0 0 22px;">
      <p style="margin:0 0 10px;">${emailTag(label)}</p>
      <h2 style="font-size:24px;line-height:1.25;font-weight:750;margin:0 0 10px;color:${EMAIL_BRAND_TEXT};">${statusHtml}${title}</h2>
    </div>
  `;
}

export function emailMono(value: string, fontSize = 12): string {
  return `<span style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:${fontSize}px;word-break:break-all;">${value}</span>`;
}
