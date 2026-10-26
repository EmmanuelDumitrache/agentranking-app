import { prisma } from "@/lib/db";
import { JOB_PARTNER_BRANDS } from "@/lib/jobs/partners/branding";
import {
  DEFAULT_PARTNER_SOURCES,
  ENABLED_PARTNER_SOURCE_COUNT,
  getPartnerApiKey,
  getPartnerFeedUrl,
  hasWurkListEndpointConfigured,
} from "@/lib/jobs/partner-env";

export {
  DEFAULT_PARTNER_SOURCES,
  ENABLED_PARTNER_SOURCE_COUNT,
  getPartnerApiKey,
  getPartnerFeedUrl,
  hasWurkListEndpointConfigured,
};
/** Idempotent upsert of EarnFi + WURK into job_partner_sources. */
export async function ensureDefaultJobPartnerSources(): Promise<number> {
  let upserted = 0;
  for (const source of DEFAULT_PARTNER_SOURCES) {
    const brand = JOB_PARTNER_BRANDS[source];
    await prisma.jobPartnerSource.upsert({
      where: { source },
      create: {
        id: source,
        source,
        displayName: brand.displayName,
        websiteUrl: brand.websiteUrl,
        docsUrl: brand.docsUrl ?? null,
        enabled: true,
      },
      update: {
        displayName: brand.displayName,
        websiteUrl: brand.websiteUrl,
        docsUrl: brand.docsUrl ?? null,
      },
    });
    upserted += 1;
  }
  return upserted;
}
export async function ensureDefaultJobPartnerSourcesIfEmpty(): Promise<void> {
  const count = await prisma.jobPartnerSource.count();
  if (count === 0) {
    await ensureDefaultJobPartnerSources();
  }
}