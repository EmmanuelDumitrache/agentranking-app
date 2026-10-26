import "server-only";

import { redirect } from "next/navigation";
import { isAdminIdentityAccessError } from "./auth.server";

export async function loadAdminPageData<T>(loader: () => Promise<T>): Promise<T> {
  try {
    return await loader();
  } catch (error) {
    if (isAdminIdentityAccessError(error)) redirect("/admin/login");
    throw error;
  }
}
