/** Telegram brand accent used in directory UI. */
export const TELEGRAM_BLUE = "#229ED9";
export const TELEGRAM_BOT_TYPES = ["standalone", "managed"] as const;
export type TelegramBotType = (typeof TELEGRAM_BOT_TYPES)[number];