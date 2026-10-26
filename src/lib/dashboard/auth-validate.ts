const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isValidEmail(email: string): boolean {
  const e = email.trim();
  return e.length <= 254 && EMAIL_RE.test(e);
}
export function passwordsMatch(a: string, b: string): boolean {
  return a === b;
}
export function isStrongEnoughPassword(password: string): boolean {
  return password.length >= 8;
}
