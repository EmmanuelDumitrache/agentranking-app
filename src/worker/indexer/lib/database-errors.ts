export type DatabaseErrorClass =
  | "serialization_failure"
  | "deadlock"
  | "pool_acquisition_timeout"
  | "statement_timeout"
  | "transaction_timeout"
  | "lock_timeout"
  | "unique_conflict"
  | "foreign_key_conflict"
  | "missing_schema"
  | "invalid_input"
  | "unknown";
function fields(error: unknown): { code: string; message: string; cause: unknown; meta: unknown } {
  if (!error || typeof error !== "object") return { code: "", message: String(error), cause: null, meta: null };
  const row = error as { code?: unknown; message?: unknown; cause?: unknown; meta?: unknown };
  return {
    code: typeof row.code === "string" ? row.code : "",
    message: typeof row.message === "string" ? row.message : String(error),
    cause: row.cause,
    meta: row.meta,
  };
}
export function classifyDatabaseError(error: unknown): DatabaseErrorClass {
  const { code, message, cause } = fields(error);
  if (cause && cause !== error) {
    const nested = classifyDatabaseError(cause);
    if (nested !== "unknown") return nested;
  }
  if (code === "P2034" || code === "40001") return "serialization_failure";
  if (code === "40P01") return "deadlock";
  if (code === "P2024") return "pool_acquisition_timeout";
  if (code === "P2002" || code === "23505") return "unique_conflict";
  if (code === "P2003" || code === "23503") return "foreign_key_conflict";
  if (["P2021", "P2022", "42P01", "42703"].includes(code)) return "missing_schema";
  if (["P2000", "P2005", "P2006", "P2007", "P2011", "P2012", "P2013", "22P02"].includes(code)) return "invalid_input";
  if (code === "57014" || /canceling statement due to statement timeout/i.test(message)) return "statement_timeout";
  if (code === "P2028" || /expired transaction|transaction api error[^\n]*timeout/i.test(message)) return "transaction_timeout";
  if (code === "55P03" || /canceling statement due to lock timeout/i.test(message)) return "lock_timeout";
  if (code === "P1002" || /timed out fetching a new connection from the connection pool/i.test(message)) {
    return "pool_acquisition_timeout";
  }
  if (/deadlock detected/i.test(message)) return "deadlock";
  if (/serialization failure|could not serialize access|transactionwriteconflict|write conflict/i.test(message)) return "serialization_failure";
  return "unknown";
}
export function isTransactionRetryableDatabaseError(error: unknown): boolean {
  const classification = classifyDatabaseError(error);
  return classification === "serialization_failure" || classification === "deadlock" || classification === "lock_timeout" || classification === "transaction_timeout";
}
export function isSafePreExecutionDatabaseRetry(error: unknown): boolean {
  return classifyDatabaseError(error) === "pool_acquisition_timeout";
}
