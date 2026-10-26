#!/usr/bin/env -S pnpm exec tsx
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getCuratedAgentsForOrbitSkill,
  getOrbitSkills,
} from "@/lib/orbit/orbit-curated-agents";
import { prisma } from "@/lib/db";
import { ORBIT_CURATED_MCP_VERSION } from "@/lib/orbit/orbit-api";
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) loadEnvFile(file);
}
const OUTPUT_PATH = path.join(process.cwd(), "public", "partners", "orbit", "curated-mcps.json");
async function main() {
  const skills = getOrbitSkills().sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label));
  const recommendations = await Promise.all(
    skills.map((skill) =>
      getCuratedAgentsForOrbitSkill(skill.id, {
        limit: 10,
      }),
    ),
  );
  const payload = {
    version: ORBIT_CURATED_MCP_VERSION,
    generatedAt: new Date().toISOString(),
    schemaVersion: "orbit-curated-mcps.v0",
    integration: "AgentRanking x Orbit curated MCP/agent skill recommendations",
    notes: [
      "The integration provides discovery and curation only.",
      "Execution, escrow, payment routing, and agent calls are handled by Orbit or the target agent.",
      "Agents are read from the existing AgentRanking database; no fake agents are generated.",
    ],
    skills,
    recommendations: recommendations.filter((item) => item != null),
  };
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });