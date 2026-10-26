import { cn } from "@/lib/utils";
import { getArchetype } from "@/lib/archetype-classifier";
import { agentsArchetypeHref } from "@/lib/agents-archetype-filter";
import Link from "next/link";
interface Props {
  archetype: string;
  isAuto?: boolean;
  size?: "xs" | "sm";
  asLink?: boolean;
  className?: string;
}
export function ArchetypePill({ archetype, isAuto, size = "xs", asLink = false, className }: Props) {
  if (!archetype) return null;
  const info = getArchetype(archetype);
  if (!info) return null;
  const sizeClass = size === "sm" ? "px-2.5 py-1 text-xs" : "px-2 py-0.5 text-[10px]";
  const pill = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium border whitespace-nowrap",
        sizeClass,
        info.bgColor,
        info.textColor,
        info.borderColor,
        className
      )}
      title={isAuto ? `Auto-detected: ${info.label}` : info.label}
    >
      {info.label}
      {isAuto && <span className="opacity-50 text-[9px]">·auto</span>}
    </span>
  );
  if (asLink) {
    return (
      <Link href={agentsArchetypeHref(archetype)} className="hover:opacity-80 transition-opacity">
        {pill}
      </Link>
    );
  }
  return pill;
}