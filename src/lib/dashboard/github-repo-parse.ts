/** Normalize user input to `owner/repo` (accepts URLs or bare slugs). */
export function normalizeGithubRepoFullName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!trimmed.includes("://") && !trimmed.startsWith("github.com")) {
    const parts = trimmed.replace(/^\/+/, "").split("/").filter(Boolean);
    if (parts.length === 2 && parts[0] && parts[1]) {
      return `${parts[0]}/${parts[1]}`.toLowerCase();
    }
    return null;
  }
  try {
    const url = trimmed.startsWith("http") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `${parts[0]}/${parts[1]}`.toLowerCase();
    }
  } catch {
    return null;
  }
  return null;
}
