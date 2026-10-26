export const ARCHETYPES = [
  { slug: "trading", label: "Trading", color: "#3b82f6", bgColor: "bg-blue-500/15", textColor: "text-blue-400", borderColor: "border-blue-500/30" },
  { slug: "arbitrage", label: "Arbitrage", color: "#8b5cf6", bgColor: "bg-violet-500/15", textColor: "text-violet-400", borderColor: "border-violet-500/30" },
  { slug: "sniper", label: "Sniper", color: "#ef4444", bgColor: "bg-red-500/15", textColor: "text-red-400", borderColor: "border-red-500/30" },
  { slug: "yield", label: "Yield Farmer", color: "#22c55e", bgColor: "bg-green-500/15", textColor: "text-green-400", borderColor: "border-green-500/30" },
  { slug: "builder", label: "Builder", color: "#f97316", bgColor: "bg-orange-500/15", textColor: "text-orange-400", borderColor: "border-orange-500/30" },
  { slug: "analytics", label: "Analytics", color: "#06b6d4", bgColor: "bg-cyan-500/15", textColor: "text-cyan-400", borderColor: "border-cyan-500/30" },
  { slug: "bridge", label: "Bridge", color: "#a855f7", bgColor: "bg-purple-500/15", textColor: "text-purple-400", borderColor: "border-purple-500/30" },
  { slug: "copy_trader", label: "Copy Trader", color: "#eab308", bgColor: "bg-yellow-500/15", textColor: "text-yellow-400", borderColor: "border-yellow-500/30" },
  { slug: "social", label: "Social", color: "#ec4899", bgColor: "bg-pink-500/15", textColor: "text-pink-400", borderColor: "border-pink-500/30" },
  { slug: "mev", label: "MEV", color: "#f43f5e", bgColor: "bg-rose-500/15", textColor: "text-rose-400", borderColor: "border-rose-500/30" },
  { slug: "telegram", label: "Telegram", color: "#229ED9", bgColor: "bg-[#229ED9]/10", textColor: "text-[#229ED9]", borderColor: "border-[#229ED9]/30" },
] as const;
export type ArchetypeSlug = (typeof ARCHETYPES)[number]["slug"];
export function getArchetype(slug: string) {
  return ARCHETYPES.find((a) => a.slug === slug) ?? null;
}
export function isValidArchetypeSlug(slug: string): slug is ArchetypeSlug {
  return ARCHETYPES.some((a) => a.slug === slug);
}
/** Keyword rules per archetype — order matters (first match wins) */
