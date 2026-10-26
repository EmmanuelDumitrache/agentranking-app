/** Dashboard authentication routes intentionally avoid workspace providers and data loading. */
export default function DashboardAuthLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return children;
}
