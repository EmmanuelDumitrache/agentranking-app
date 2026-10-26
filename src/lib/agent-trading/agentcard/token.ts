import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function readAgentCardTokenFromCliConfig(): string | null {
  const explicitPath = process.env.AGENTCARD_CONFIG_PATH?.trim();
  const candidates = [
    explicitPath,
    join(homedir(), ".agentcard", "config.json"),
  ].filter((value): value is string => Boolean(value));

  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed = JSON.parse(raw) as { token?: unknown };
      if (typeof parsed.token === "string" && parsed.token.trim()) {
        return parsed.token.trim();
      }
    } catch {
      /* try next path */
    }
  }

  return null;
}
