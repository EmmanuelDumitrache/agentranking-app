import "server-only";

import { getSession, type AdminSession } from "@/lib/admin-auth";

export class AdminIdentityAccessError extends Error {
  readonly status: 401;

  constructor() {
    super("Unauthorized");
    this.name = "AdminIdentityAccessError";
    this.status = 401;
  }
}

export async function requireAdminIdentity(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) throw new AdminIdentityAccessError();
  return session;
}

export function isAdminIdentityAccessError(error: unknown): error is AdminIdentityAccessError {
  return error instanceof AdminIdentityAccessError;
}
