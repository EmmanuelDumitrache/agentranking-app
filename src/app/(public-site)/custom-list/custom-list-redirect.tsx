"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function CustomListRedirect({ href }: { readonly href: string }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setTimeout(() => router.push(href), 2_000);
    return () => clearTimeout(timer);
  }, [href, router]);
  return null;
}
