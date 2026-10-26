export function DocsAvailability({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="docs-callout">
      <span className="docs-card-title">Availability: </span>
      <span className="docs-body">{children}</span>
    </p>
  );
}