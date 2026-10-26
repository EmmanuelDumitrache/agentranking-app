"use client";

import { useEffect } from "react";
import { AdminSidebarShell } from "./admin-sidebar";

/** Portal-only client chrome. The login route is outside this layout subtree. */
export function AdminChrome({ children }: Readonly<{ children: React.ReactNode }>) {
  useEffect(() => {
    fetch("/api/admin/session/heartbeat", {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }, []);

  return (
    <AdminSidebarShell>
      <div className="container mx-auto max-w-6xl px-4 py-8">{children}</div>
    </AdminSidebarShell>
  );
}
