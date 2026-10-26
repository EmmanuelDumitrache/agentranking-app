export function isPrismaStatementTimeoutMessage(message: string): boolean {
  return /canceling statement due to statement timeout|statement timeout|code[=: ]+57014|\b57014\b/i.test(
    message,
  );
}
