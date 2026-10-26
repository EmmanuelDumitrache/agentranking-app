import { AdminChrome } from "@/app/admin/admin-chrome";
import { AdminPortalProviders } from "@/providers/admin-portal-providers";

export const dynamic = "force-dynamic";

export default function AdminPortalLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminPortalProviders>
      <AdminChrome>{children}</AdminChrome>
    </AdminPortalProviders>
  );
}
