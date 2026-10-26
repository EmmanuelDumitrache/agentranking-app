import type { TelegramBotType } from "@/lib/telegram/constants";
export type TelegramAgentMeta = {
  botUsername: string | null;
  botType: TelegramBotType | "unknown";
  managerBot: string | null;
  spawnUrl: string | null;
  tags: string[];
  avatarUrl: string | null;
  isManaged: boolean;
};
type MetaRow = { readonly key: string; readonly value: string };
function metaValue(metadata: readonly MetaRow[] | undefined, key: string): string | null {
  const row = metadata?.find((m) => m.key === key);
  const v = row?.value?.trim();
  return v ? v : null;
}
export function parseTelegramAgentMeta(
  metadata: readonly MetaRow[] | undefined,
  fallbackImage?: string | null,
): TelegramAgentMeta {
  const botUsername = metaValue(metadata, "telegramBotUsername");
  const rawType = metaValue(metadata, "telegramBotType");
  const managerBot = metaValue(metadata, "telegramManagerBotUsername");
  const spawnUrl = metaValue(metadata, "telegramSpawnUrl");
  const tagsRaw = metaValue(metadata, "tags");
  const avatarUrl = metaValue(metadata, "telegramAvatarUrl") ?? fallbackImage ?? null;
  const botType: TelegramBotType | "unknown" =
    rawType === "managed" || rawType === "standalone" ? rawType : "unknown";
  const isManaged = botType === "managed" || !!managerBot;
  return {
    botUsername,
    botType: isManaged && botType === "unknown" ? "managed" : botType,
    managerBot,
    spawnUrl,
    tags: tagsRaw ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean) : [],
    avatarUrl,
    isManaged,
  };
}
export function telegramBotProfileUrl(username: string | null, fallbackName: string): string {
  if (username) return `https://t.me/${username}`;
  const slug = fallbackName.split(/\s+/).join("").toLowerCase();
  return `https://t.me/${slug}`;
}