import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin | AgentRanking",
  description: "AgentRanking admin portal",
  robots: "noindex, nofollow",
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
