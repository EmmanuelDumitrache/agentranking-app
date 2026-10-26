import { PowerBoostClient } from "@/app/(public-site)/powerboost/powerboost-client";
import {
  normalizePowerBoostSearchParams,
  readPowerBoostPageData,
} from "@/app/(public-site)/powerboost/powerboost.server";
type SearchParams = Record<string, string | string[] | undefined>;
type Props = { readonly searchParams: Promise<SearchParams> };
export const dynamic = "force-dynamic";
export default async function PowerBoostPage({ searchParams }: Props) {
  const normalized = normalizePowerBoostSearchParams(await searchParams);
  const snapshot = await readPowerBoostPageData(normalized);
  return (
    <PowerBoostClient
      key={`${normalized.period}:${normalized.page}`}
      initialData={snapshot.data}
      initialDataUpdatedAt={snapshot.generatedAtMs}
      page={normalized.page}
      timePeriod={normalized.period}
    />
  );
}
