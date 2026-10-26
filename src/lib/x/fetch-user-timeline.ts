import { z } from "zod";
import type { AgentXPost } from "@/lib/agent-x-posts";
import { getXApiBearerToken } from "@/lib/x/x-api-auth";
import { mapTweetRow, xApiGet, XTweetRowSchema } from "@/lib/x/x-api-client";
const DEFAULT_MAX = 8;

const XTimelineResponseSchema = z.object({
  data: z.array(XTweetRowSchema).optional(),
  errors: z.array(z.object({ message: z.string().optional() })).optional(),
});

/** GET /2/users/:id/tweets — timeline by numeric user id. */
export async function fetchLatestTweetsByUserId(
  userId: string,
  displayHandle: string,
  maxResults = DEFAULT_MAX,
): Promise<AgentXPost[]> {
  if (!getXApiBearerToken()) return [];
  const count = Math.min(Math.max(maxResults, 5), 10);
  const tweets = await xApiGet(
    `/users/${userId}/tweets?max_results=${count}&tweet.fields=created_at,public_metrics,text&exclude=retweets,replies`,
    XTimelineResponseSchema,
  );
  const out: AgentXPost[] = [];
  for (const row of tweets.data ?? []) {
    const post = mapTweetRow(row, displayHandle);
    if (post) out.push(post);
    if (out.length >= maxResults) break;
  }
  return out;
}