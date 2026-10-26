import type { Metadata } from "next";
import { TelegramDirectoryPage } from "@/components/telegram/telegram-directory-page";
import { buildSeoMetadata } from "@/lib/seo";
import { normalizeTelegramDirectoryQuery } from "@/lib/agent-directory/telegram-directory";
import { readTelegramDirectoryPage } from "@/lib/agent-directory/telegram-directory.server";
export const metadata: Metadata = buildSeoMetadata({
  path: "/telegram",
  title: "Telegram Bots — AI & crypto bot directory",
  description:
    "Browse Telegram AI and crypto bots on AgentRanking — standalone bots and managed spawn flows, ranked by score and verification.",
});
type Props = { readonly searchParams: Promise<Record<string, string | string[] | undefined>> };
export const dynamic = "force-dynamic";
export default async function TelegramPage({ searchParams }: Props) {
  const initialQuery = normalizeTelegramDirectoryQuery(await searchParams);
  const initialData = await readTelegramDirectoryPage(initialQuery);
  return <TelegramDirectoryPage initialData={initialData} initialQuery={initialQuery} />;
}
