import { CustomListClient } from "@/app/(public-site)/custom-list/custom-list-client";
import {
  readCustomListPricing,
  unavailableCustomListPricing,
} from "@/app/(public-site)/custom-list/custom-list-pricing.server";
export const dynamic = "force-dynamic";
export default async function CustomListPage() {
  const pricing = await readCustomListPricing().catch((error: unknown) => {
    console.error("[custom-list] unable to load pricing", error);
    return unavailableCustomListPricing();
  });
  return <CustomListClient initialPricing={pricing} />;
}
