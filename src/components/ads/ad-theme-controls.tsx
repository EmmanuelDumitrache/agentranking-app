"use client";
import {
  BarChart3,
  Bot,
  Code2,
  Coins,
  Flame,
  Gem,
  Globe2,
  Megaphone,
  Palette,
  Rocket,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  TrendingUp,
  type LucideIcon,
  Zap,
} from "lucide-react";
import {
  AD_ACCENT_COLOR_OPTIONS,
  AD_ICON_OPTIONS,
  DEFAULT_AD_ACCENT_COLOR,
  type AdIconKey,
} from "@/lib/ad-theme";
import { cn } from "@/lib/utils";
const ICONS: Record<AdIconKey, LucideIcon> = {
  shield: ShieldCheck,
  rocket: Rocket,
  bot: Bot,
  sparkles: Sparkles,
  trending: TrendingUp,
  megaphone: Megaphone,
  zap: Zap,
  star: Star,
  target: Target,
  flame: Flame,
  gem: Gem,
  globe: Globe2,
  code: Code2,
  chart: BarChart3,
  coins: Coins,
};
export function AdThemeIcon({
  iconKey,
  accentColor = DEFAULT_AD_ACCENT_COLOR,
  className,
}: {
  readonly iconKey: AdIconKey | string;
  readonly accentColor?: string;
  readonly className?: string;
}) {
  const Icon = ICONS[iconKey as AdIconKey] ?? ShieldCheck;
  return <Icon className={cn("shrink-0", className)} style={{ color: accentColor }} aria-hidden />;
}
export function AdThemeControls({
  iconKey,
  accentColor,
  onIconChange,
  onAccentColorChange,
  disabled = false,
}: {
  readonly iconKey: AdIconKey;
  readonly accentColor: string;
  readonly onIconChange: (iconKey: AdIconKey) => void;
  readonly onAccentColorChange: (color: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor="ad-icon-key" className="mb-1 flex items-center gap-2 text-xs font-medium">
            <Palette className="size-4 text-muted-foreground" aria-hidden />
            Icon
          </label>
          <div className="flex items-center gap-2">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background"
              style={{ backgroundColor: `${accentColor}18` }}
            >
              <AdThemeIcon iconKey={iconKey} accentColor={accentColor} className="size-5" />
            </span>
            <select
              id="ad-icon-key"
              value={iconKey}
              disabled={disabled}
              onChange={(event) => onIconChange(event.target.value as AdIconKey)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
            >
              {AD_ICON_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Used in the text ad preview, popup footer, and live placements.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {AD_ACCENT_COLOR_OPTIONS.map((color) => (
          <button
            key={color}
            type="button"
            disabled={disabled}
            aria-label={`Use accent ${color}`}
            onClick={() => onAccentColorChange(color)}
            className={cn(
              "size-7 rounded-full border transition-transform",
              accentColor.toLowerCase() === color
                ? "border-foreground scale-110"
                : "border-border hover:scale-105",
            )}
            style={{ backgroundColor: color }}
          />
        ))}
        <label className="ml-auto flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>Custom</span>
          <input
            type="color"
            value={accentColor}
            disabled={disabled}
            onChange={(event) => onAccentColorChange(event.target.value)}
            className="h-8 w-10 rounded border border-border bg-background p-1"
          />
        </label>
      </div>
    </div>
  );
}