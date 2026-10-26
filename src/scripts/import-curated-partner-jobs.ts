/**
 * Import curated partner jobs from JSON.
 * Internal source utility. Invoke it explicitly with tsx only during controlled administration.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "@/lib/db";
import { validateCuratedJobInput, type CuratedJobInput } from "@/lib/jobs/curated";
import { ensureDefaultJobPartnerSources } from "@/lib/jobs/partner-sources";
import { upsertPartnerJob } from "@/lib/jobs/sync";
type ImportFile = {
  jobs: CuratedJobInput[];
};
function parseArgs(): string {
  const idx = process.argv.indexOf("--file");
  if (idx >= 0 && process.argv[idx + 1]) {
    return resolve(process.argv[idx + 1]!);
  }
  return resolve(process.cwd(), "data/jobs/curated-partner-jobs.json");
}
async function main() {
  const allowSample = process.env.JOBS_IMPORT_ALLOW_SAMPLE === "1";
  const productionCheckout = process.env.NODE_ENV === "production";
  const filePath = parseArgs();
  let raw: ImportFile;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as ImportFile;
  } catch (error) {
    throw new Error(`Failed to read ${filePath}`, { cause: error });
  }
  if (!Array.isArray(raw.jobs) || raw.jobs.length === 0) {
    throw new Error("No jobs in file.");
  }
  await ensureDefaultJobPartnerSources();
  const now = new Date();
  let upserted = 0;
  let skipped = 0;
  for (const row of raw.jobs) {
    const validated = validateCuratedJobInput(row, { allowSample });
    if (!validated.ok) {
      console.warn(`Skip: ${validated.error}`);
      skipped += 1;
      continue;
    }
    const job = {
      ...validated.job,
      ingestionMode: "manual" as const,
      curatedBy: "import-script",
      isSample: row.isSample === true,
    };
    if (job.isSample && productionCheckout && !allowSample) {
      console.warn(`Skip sample job in production: ${job.title}`);
      skipped += 1;
      continue;
    }
    await upsertPartnerJob(job, now);
    upserted += 1;
  }
  console.log(`Imported ${upserted} curated jobs (${skipped} skipped) from ${filePath}`);
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
