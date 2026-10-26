import "../config.js";
import { fetchAndPersistChainVerification } from "../sync/validation-registry.js";
import { prisma } from "../db.js";
import { parseStrictUnsignedInteger } from "../lib/strict-integer.js";
async function main() {
  let chainId: number;
  let agentId: number;
  try {
    chainId = parseStrictUnsignedInteger(process.argv[2], "chainId", { maximum: 2_147_483_647 });
    agentId = parseStrictUnsignedInteger(process.argv[3], "agentId", { allowZero: true, maximum: 2_147_483_647 });
  } catch {
    console.error("Usage: validation-hydrate <chainId> <agentId>");
    process.exitCode = 2;
    return;
  }
  const row = await fetchAndPersistChainVerification(chainId, agentId);
  console.log(row ?? { chainId, agentId, verified: false, note: "no ValidationResponse logs found" });
}
void main()
  .catch((error) => {
    console.error(error);
    if (!process.exitCode) process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
