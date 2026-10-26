import { prisma } from "@/lib/db";
import { fetchOpenRouterCredits } from "@/lib/llm-provider/openrouter-credits";
import { usdAmountToMicros } from "@/lib/llm-provider/costing";
export async function openRouterBalanceSnapshotJob() {
  const credits = await fetchOpenRouterCredits();
  if (!credits) throw new Error("OpenRouter credit fetch failed");
  if (credits.remaining === null) {
    return { ok: true, skipped: true, reason: "key_spending_limit_unset", credits };
  }
  await prisma.llmProviderBalanceSnapshot.create({
    data: {
      provider: "openrouter",
      balanceUsdMicros: usdAmountToMicros(credits.remaining),
      rawResponse: credits as never,
    },
  });
  return { ok: true, credits };
}
