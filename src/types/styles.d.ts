/**
 * TypeScript 6 checks side-effect-only imports by default. Next.js owns CSS
 * loading at build time, so declare the stylesheet module surface explicitly
 * while retaining useful typing for CSS Module default imports.
 */
declare module "*.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}
