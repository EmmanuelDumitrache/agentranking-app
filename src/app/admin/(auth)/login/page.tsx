import { Suspense } from "react";
import { AdminAuthPage } from "@/components/ui/auth-page";
export default function AdminLoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading…</div>}>
      <AdminAuthPage />
    </Suspense>
  );
}