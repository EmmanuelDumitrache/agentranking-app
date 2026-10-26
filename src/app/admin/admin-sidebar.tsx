"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LayoutDashboard, LogOut, Menu } from "lucide-react";
import { ADMIN_NAV_GROUPS, isAdminNavActive, isAdminNavGroupMuted } from "./admin-nav-config";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
function AdminLogoutButton({
  className,
  onDone,
}: Readonly<{
  className?: string;
  onDone?: () => void;
}>) {
  const router = useRouter();
  async function handleLogout() {
    onDone?.();
    await fetch("/api/admin/auth/logout", { method: "POST", credentials: "include" });
    router.push("/admin/login");
    router.refresh();
  }
  return (
    <Button variant="outline" size="sm" onClick={handleLogout} className={cn("w-full gap-1.5 justify-center", className)}>
      <LogOut className="size-4 shrink-0" />
      Log out
    </Button>
  );
}
export function AdminSidebarNav({
  className,
  onNavigate,
}: Readonly<{
  className?: string;
  onNavigate?: () => void;
}>) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex flex-col gap-6", className)} aria-label="Admin">
      {ADMIN_NAV_GROUPS.map((group) => {
        const muted = isAdminNavGroupMuted(group.title);
        return (
          <div key={group.title}>
            <p
              className={cn(
                "mb-2 px-3 text-[11px] font-semibold uppercase tracking-wide",
                muted ? "text-muted-foreground/60" : "text-muted-foreground",
              )}
            >
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isAdminNavActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-primary/15 font-medium text-primary"
                          : muted
                            ? "text-muted-foreground/70 hover:bg-muted/60 hover:text-muted-foreground"
                            : "text-muted-foreground hover:bg-muted/80 hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0 opacity-80" />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
export function AdminSidebarShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className="relative hidden w-56 shrink-0 flex-col border-r border-border bg-card/40 md:flex">
        <div className="border-b border-border px-4 py-4">
          <Link href="/admin" className="flex items-center gap-2 font-semibold text-foreground transition-colors hover:text-primary">
            <LayoutDashboard className="size-5 shrink-0 text-primary" />
            <span className="truncate">AgentRanking Admin</span>
          </Link>
          <p className="mt-1 pl-7 text-[11px] text-muted-foreground">Creators · agents · ops</p>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <AdminSidebarNav />
        </div>
        <div className="border-t border-border p-3">
          <AdminLogoutButton />
        </div>
      </aside>
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="Open admin menu">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-[min(100vw-3rem,18rem)] flex-col gap-0 border-border p-0">
              <div className="border-b border-border px-4 py-4">
                <Link
                  href="/admin"
                  className="flex items-center gap-2 font-semibold"
                  onClick={() => setMobileOpen(false)}
                >
                  <LayoutDashboard className="size-5 shrink-0" />
                  AgentRanking Admin
                </Link>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <AdminSidebarNav onNavigate={() => setMobileOpen(false)} />
              </div>
              <div className="border-t border-border p-3">
                <AdminLogoutButton onDone={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <Link href="/admin" className="min-w-0 truncate font-semibold">
            Admin
          </Link>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}