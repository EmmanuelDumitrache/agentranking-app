export type WhatsNewEntry = {
  id: string;
  date: string;
  title: string;
  body: string;
};

/** Newest first. Bump `id` when shipping a new entry so the unread blue dot returns. */
export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    id: "2026-08-16-creator-flow-refresh",
    date: "2026-08-16",
    title: "Creator flow and launchpad refresh",
    body:
      "Create-agent wizard now has clearer five-step guidance, drag-and-drop avatars, and a richer review screen with account verification and post-create routing. The launchpad separates chain and protocol selection (Solana, Pump.fun, Metaplex, Robinhood Chain) with a balanced mobile layout and drag-and-drop token images. Account sidebar controls add name privacy masking and an in-app profile editor.",
  },
  {
    id: "2026-08-16-agent-profile-editing",
    date: "2026-08-16",
    title: "Agent profile editing and versions",
    body:
      "Edit public agent profiles from Overview or Settings with a quick edit shortcut. Publish profile changes and version notes from the Social page, with clearer toasts and overview-style panels.",
  },
  {
    id: "2026-08-16-chat-and-import",
    date: "2026-08-16",
    title: "Faster chat and safer agent import",
    body:
      "New chat opens instantly when you are already in chat, with a cleaner composer (plus attach, send icon, subtle focus glow). Import agent config now rejects secrets more accurately and supports JSON file upload with an improved migration prompt.",
  },
  {
    id: "2026-08-13-register-launch-polish",
    date: "2026-08-13",
    title: "Register on Solana, creator fees, and launch polish",
    body:
      "Register lists your agent on the Solana public directory (~0.01 SOL network fee, free on AgentRanking). Tokenized agents also get an AgentRanking identity stamp. When registered, look for the fingerprint badge next to your agent name — sidebar, overview, and public profile. Explorers read your live registration JSON (name, photo, bio, capabilities). Creator fees on the launchpad now auto-refresh with real amounts; force-claim when the pool is ready. Wallet balances in the top bar update automatically. Token launch images stay separate from your agent avatar. Graduation bar accuracy improved for bonding-curve tokens.",
  },
  {
    id: "2026-08-07-schedule",
    date: "2026-08-07",
    title: "Agent Schedule",
    body:
      "Each agent now has a Schedule tab under Agent in the sidebar. Set up to five recurring tasks — prompts, reports, and more — on hourly, daily, or weekly timing. Free models run at no cost; paid models use your LLM credits. Pause, reorder, run now, or review history anytime.",
  },
  {
    id: "2026-08-07-homepage",
    date: "2026-08-07",
    title: "New homepage",
    body:
      "agentranking.io has a refreshed landing page with live agent rankings, launchpad highlights, staking tiers, and a clearer path to launch tokens on Solana or Robinhood Chain.",
  },
  {
    id: "2026-08-07-paybox",
    date: "2026-08-07",
    title: "PayBox wallet verification",
    body:
      "Dashboard → Verification now includes a PayBox wallet trust check so operators can confirm wallet ownership and status alongside existing agent verification flows.",
  },
  {
    id: "2026-07-29-memory",
    date: "2026-07-29",
    title: "Agent Memory",
    body:
      "Each agent now has a Memory tab. Chat learns durable preferences and facts, applies them in future conversations, and lets you review, approve, or archive what was saved.",
  },
  {
    id: "2026-07-28-security",
    date: "2026-07-28",
    title: "Account Security",
    body:
      "Settings → Account now includes a Security section. Turn on Google Authenticator (TOTP) with one-time backup codes, and/or email login codes via Resend. After Google, X, or wallet sign-in, you'll verify with either enabled factor. Disabling a factor requires a current security code; admins can reset 2FA if you're locked out.",
  },
  {
    id: "2026-07-28-whats-new",
    date: "2026-07-28",
    title: "What's new in the app",
    body:
      "This What's new panel is the in-app update log (v1). When we ship product changes, they show up here — look for the blue unread dot next to Guide me.",
  },
] as const;

export const WHATS_NEW_LATEST_ID = WHATS_NEW_ENTRIES[0]?.id ?? "";

export const WHATS_NEW_SEEN_STORAGE_KEY = "ar.whatsNew.seenId";

export function isWhatsNewUnread(seenId: string | null | undefined): boolean {
  if (!WHATS_NEW_LATEST_ID) return false;
  return (seenId ?? "") !== WHATS_NEW_LATEST_ID;
}
