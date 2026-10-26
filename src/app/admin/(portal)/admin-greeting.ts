/** Local browser clock: gm daytime band, gn overnight. */
export function adminGreetingToken(now = new Date()): "gm" | "gn" {
  const h = now.getHours();
  return h >= 5 && h < 22 ? "gm" : "gn";
}
export function adminGreetingTitle(now = new Date()): string {
  return adminGreetingToken(now) === "gm" ? "Good morning" : "Good night";
}