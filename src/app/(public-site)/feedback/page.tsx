import { FeedbackPageClient } from "./feedback-page-client";
import { normalizePublicFeedbackQuery } from "@/lib/agent-directory/feedback";
import { readPublicFeedbackPage } from "@/lib/agent-directory/feedback.server";
type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const dynamic = "force-dynamic";
export default async function FeedbackPage({ searchParams }: Props) {
  const initialQuery = normalizePublicFeedbackQuery(await searchParams);
  const initialData = await readPublicFeedbackPage(initialQuery);
  return <FeedbackPageClient initialData={initialData} initialQuery={initialQuery} />;
}
