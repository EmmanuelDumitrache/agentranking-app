import type { PublicPartnerJob } from "@/lib/jobs/types";
const INSTRUCTION_KEYS = [
  "agent_instructions",
  "agentInstructions",
  "instructions",
  "instruction",
  "steps",
  "how_to",
  "howTo",
  "tasks",
  "verification_steps",
  "verification_requirements",
  "work_add_requirements",
  "add_requirements",
] as const;
function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
function formatInstructionList(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}
function asInstructionText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (Array.isArray(value)) {
    const items = value.map((entry) => asString(entry)).filter(Boolean);
    return items.length > 0 ? formatInstructionList(items) : null;
  }
  return null;
}
function extractFromRequirements(requirements: unknown): string | null {
  if (requirements == null) return null;
  if (typeof requirements === "string") return asInstructionText(requirements);
  if (Array.isArray(requirements)) return asInstructionText(requirements);
  if (typeof requirements === "object") {
    const record = requirements as Record<string, unknown>;
    for (const key of INSTRUCTION_KEYS) {
      const text = asInstructionText(record[key]);
      if (text) return text;
    }
  }
  return null;
}
function looksLikeInstructionCopy(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /^\d+\.\s/m.test(text) ||
    lower.includes("how to participate") ||
    lower.includes("how to complete") ||
    lower.startsWith("steps:") ||
    lower.startsWith("task:") ||
    lower.includes("your article should") ||
    lower.includes("rules:") ||
    lower.includes("requirements:")
  );
}
function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}
/** Full agent-oriented instructions when available from requirements or description. */
export function getJobAgentInstructions(job: PublicPartnerJob): string | null {
  const fromRequirements = extractFromRequirements(job.requirements);
  if (fromRequirements) return fromRequirements;
  const description = job.description.trim();
  const title = job.title.trim();
  if (description && description !== title && looksLikeInstructionCopy(description)) {
    return description;
  }
  return null;
}
/** One-line preview for job cards on the listing grid. */
export function getJobAgentInstructionPreview(job: PublicPartnerJob, maxLen = 100): string | null {
  const full = getJobAgentInstructions(job);
  if (!full) return null;
  const title = normalizeForCompare(job.title);
  const normalized = full.replace(/\s+/g, " ").trim();
  if (normalizeForCompare(normalized) === title) return null;
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1).trimEnd()}…`;
}
/** Whether requirements should render as a separate section (not duplicated under agent instructions). */
export function shouldShowRequirementsSection(
  requirements: unknown,
  agentInstructions: string | null,
): boolean {
  if (requirements == null) return false;
  if (!agentInstructions) return true;
  const fromRequirements = extractFromRequirements(requirements);
  if (!fromRequirements) {
    if (typeof requirements === "object" && !Array.isArray(requirements)) {
      const entries = Object.entries(requirements as Record<string, unknown>).filter(
        ([key, value]) =>
          value != null &&
          value !== "" &&
          !INSTRUCTION_KEYS.includes(key as (typeof INSTRUCTION_KEYS)[number]),
      );
      return entries.length > 0;
    }
    return false;
  }
  return normalizeForCompare(fromRequirements) !== normalizeForCompare(agentInstructions);
}