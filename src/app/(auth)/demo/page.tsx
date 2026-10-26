import { notFound, redirect } from "next/navigation";
import { isDemoMode } from "@/lib/demo-mode";

/** One-click entry to the demo workspace: the demo login page signs in on arrival. */
export default function DemoEntryPage() {
  if (!isDemoMode()) notFound();
  redirect("/auth/login?callbackUrl=%2Fdashboard");
}
