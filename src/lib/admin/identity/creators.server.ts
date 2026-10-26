import "server-only";

import {
  listAdminCreators,
  loadAdminCreatorDetail,
} from "@/lib/admin-creators-data";
import { requireAdminIdentity } from "./auth.server";
import type { AdminCreatorsQuery } from "./query";
import type {
  AdminCreatorDetailDto,
  AdminCreatorsResponse,
} from "./types";

export async function readAdminCreators(query: AdminCreatorsQuery): Promise<AdminCreatorsResponse> {
  await requireAdminIdentity();
  return listAdminCreators(query);
}

export async function readAdminCreatorDetail(accountId: string): Promise<AdminCreatorDetailDto | null> {
  await requireAdminIdentity();
  return loadAdminCreatorDetail(accountId);
}
