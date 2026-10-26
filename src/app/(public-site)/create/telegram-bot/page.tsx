import type { Metadata } from "next";
import { TelegramBotSubmitForm } from "@/app/(public-site)/create/telegram-bot/telegram-bot-submit-form";

export const metadata: Metadata = {
  title: "Submit Telegram Bot — AgentRanking",
  description: "List a standalone or managed Telegram bot in the AgentRanking directory.",
};

export default function TelegramBotSubmitPage() {
  return <TelegramBotSubmitForm />;
}
