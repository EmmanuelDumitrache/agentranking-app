/** Admin authentication intentionally excludes portal chrome, heartbeat, and query state. */
export default function AdminAuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
