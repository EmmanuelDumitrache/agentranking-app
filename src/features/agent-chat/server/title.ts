export function deriveThreadTitle(firstUserMessage: string): string {
  // Clean up the message
  const cleaned = firstUserMessage.trim().replace(/\s+/g, " ");
  // Get first sentence or first N chars
  const firstSentence = cleaned.split(/[.!?]\s/)[0] ?? cleaned;
  // Truncate to 60 chars, breaking at word boundary
  if (firstSentence.length <= 60) return firstSentence || "New chat";
  const truncated = firstSentence.slice(0, 57);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + "...";
}