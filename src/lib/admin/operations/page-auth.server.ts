import "server-only";

import { redirect } from "next/navigation";
import { isAdminOperationsUnauthorized } from "./auth.server";

export async function loadAdminOperationsPage<T>(
  loader: () => Promise<T>,
): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isAdminOperationsUnauthorized(error)) redirect("/admin/login");
    throw error;
  }
}
