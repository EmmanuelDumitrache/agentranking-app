import { randomUUIDv7 } from "@/lib/uuid-v7";
export type VersionEntry = {
  entryId: string;
  label: string;
  releaseNotes: string;
  trafficNote: string;
  updatedAt: string;
};
export type VersionManifest = {
  current: VersionEntry;
  history: VersionEntry[];
};
export const VERSION_MANIFEST_KEY = "dashboard.versionManifest";
export const VERSION_MANIFEST_MAX_JSON = 6000;
function defaultManifest(): VersionManifest {
  const now = new Date().toISOString();
  return {
    current: {
      entryId: randomUUIDv7(),
      label: "v1.0.0",
      releaseNotes: "",
      trafficNote: "",
      updatedAt: now,
    },
    history: [],
  };
}
function normalizeEntry(
  raw: { entryId?: unknown; label?: unknown; releaseNotes?: unknown; trafficNote?: unknown; updatedAt?: unknown },
): VersionEntry {
  const entryId =
    typeof raw.entryId === "string" && raw.entryId.trim().length > 0 ? raw.entryId.trim() : randomUUIDv7();
  return {
    entryId,
    label: String(raw.label ?? "").slice(0, 64),
    releaseNotes: String(raw.releaseNotes ?? "").slice(0, 2000),
    trafficNote: String(raw.trafficNote ?? "").slice(0, 500),
    updatedAt: String(raw.updatedAt ?? new Date().toISOString()),
  };
}
/** Parse stored JSON; lazy-backfill missing `entryId` values. */
export function parseVersionManifest(raw: string | null | undefined): VersionManifest {
  if (!raw?.trim()) return defaultManifest();
  try {
    const j = JSON.parse(raw) as VersionManifest & { current?: unknown; history?: unknown };
    if (!j?.current || typeof (j.current as { label?: string }).label !== "string") {
      return defaultManifest();
    }
    const current = normalizeEntry(j.current as VersionEntry);
    const history = Array.isArray(j.history)
      ? (j.history as Record<string, unknown>[])
          .filter((h) => h && typeof h.label === "string")
          .map((h) => normalizeEntry(h as VersionEntry))
          .slice(0, 40)
      : [];
    return { current, history };
  } catch {
    return defaultManifest();
  }
}
