import { AdminOrdersClient } from "./admin-orders-client";
import { readAdminOrders } from "@/lib/admin/operations/orders.server";
import { loadAdminOperationsPage } from "@/lib/admin/operations/page-auth.server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  readonly searchParams: SearchParams;
}) {
  const params = await searchParams;
  const initialStatus = first(params.status) ?? "all";
  const payload = await loadAdminOperationsPage(() =>
    readAdminOrders({ status: initialStatus, page: 1, perPage: 100 }),
  );
  return (
    <AdminOrdersClient
      initialStatus={initialStatus}
      initialData={{ orders: payload.orders, total: payload.total }}
    />
  );
}
