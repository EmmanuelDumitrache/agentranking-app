import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
export function AdminSectionHeader({
  title,
  description,
  href,
  linkLabel,
}: Readonly<{
  title: string;
  description?: string;
  href?: string;
  linkLabel?: string;
}>) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground mt-0.5">{description}</p> : null}
      </div>
      {href && linkLabel ? (
        <Link href={href} className="text-sm font-medium text-primary hover:underline">
          {linkLabel}
        </Link>
      ) : null}
    </div>
  );
}
export function AdminStatCard({
  href,
  label,
  value,
  sublabel,
  icon: Icon,
  iconClassName,
  featured,
}: Readonly<{
  href: string;
  label: string;
  value: string | number;
  sublabel?: string;
  icon: LucideIcon;
  iconClassName?: string;
  featured?: boolean;
}>) {
  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-xl border p-5 transition-all hover:border-primary/40 hover:shadow-sm",
        featured ? "border-primary/25 bg-primary/[0.04]" : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-3xl font-bold tracking-tight tabular-nums">{value}</p>
          {sublabel ? <p className="mt-1 text-xs text-muted-foreground">{sublabel}</p> : null}
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/60 transition-colors group-hover:bg-primary/10",
            iconClassName,
          )}
        >
          <Icon className="size-5" />
        </div>
      </div>
    </Link>
  );
}
export function AdminQuickAction({
  href,
  label,
  icon: Icon,
}: Readonly<{
  href: string;
  label: string;
  icon: LucideIcon;
}>) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-muted/40"
    >
      <Icon className="size-4 text-primary" />
      {label}
    </Link>
  );
}
export function AdminAlertBanner({
  items,
}: Readonly<{
  items: ReadonlyArray<{ id: string; title: string; count: number; href: string }>;
}>) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-200">Needs attention</p>
      <ul className="flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted/60"
            >
              <span>{item.title}</span>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                {item.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}