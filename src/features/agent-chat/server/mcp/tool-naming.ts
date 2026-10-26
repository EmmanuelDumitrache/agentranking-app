import { createHash } from "node:crypto";

function digest(value: string, length: number): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

export function mcpToolNameSlug(name: string): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "tool";
}

export function mcpToolAlias(
  connection: { id: string; runtimeKey: string },
  definition: { name: string },
  digestLength = 0,
): string {
  const stableConnection = mcpToolNameSlug(connection.runtimeKey).slice(0, 24);
  const external = mcpToolNameSlug(definition.name);
  const prefix = `mcp__${stableConnection}__`;
  const suffix = digestLength
    ? `_${digest(`${connection.id}\0${definition.name}`, digestLength)}`
    : "";
  const budget = Math.max(1, 64 - prefix.length - suffix.length);
  return `${prefix}${external.slice(0, budget)}${suffix}`;
}
