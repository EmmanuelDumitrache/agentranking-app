import { NextResponse } from "next/server";
import { reconcileActiveCheckoutAdPackagesToPublicSlots } from "@/lib/ad-package-public-sync";
import { getSession } from "@/lib/admin-auth";
export const dynamic = "force-dynamic";
/**
 * POST /api/admin/ads/reconcile-checkout-slots
 * Re-publishes strip/square for all active paid AdPackages (e.g. after deploy).
 */
export async function POST() {
  if (!(await getSession())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const count = await reconcileActiveCheckoutAdPackagesToPublicSlots();
    return NextResponse.json({ ok: true, republishedPackageCount: count });
  } catch (err) {
    console.error("reconcile-checkout-slots:", err);
    return NextResponse.json(
      { error: Error.isError(err) ? err.message : "Reconcile failed" },
      { status: 500 }
    );
  }
}
