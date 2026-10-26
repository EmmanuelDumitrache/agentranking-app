import "server-only";

import { getSession, type AdminSession } from "@/lib/admin-auth";

export class AdminOperationsUnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "AdminOperationsUnauthorizedError";
  }
}

export async function requireAdminOperationsSession(): Promise<AdminSession> {
  const session = await getSession();
  if (!session) throw new AdminOperationsUnauthorizedError();
  return session;
}

export function isAdminOperationsUnauthorized(
  error: unknown,
): error is AdminOperationsUnauthorizedError {
  return error instanceof AdminOperationsUnauthorizedError;
}

export class AdminOperationsReadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminOperationsReadError";
    this.status = status;
  }
}

export function isAdminOperationsReadError(
  error: unknown,
): error is AdminOperationsReadError {
  return error instanceof AdminOperationsReadError;
}
