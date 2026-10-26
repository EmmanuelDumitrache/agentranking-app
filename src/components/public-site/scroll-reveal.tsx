"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import styles from "./public-feature-page.module.css";
export type PublicScrollRevealVariant = "default" | "subtle";
export function PublicScrollReveal({
  children,
  className,
  variant = "default",
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly variant?: PublicScrollRevealVariant;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node || reducedMotion) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.unobserve(node);
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [reducedMotion]);
  return (
    <div
      ref={ref}
      className={cn(
        styles.sectionReveal,
        variant === "subtle" && styles.sectionRevealSubtle,
        (visible || reducedMotion) && !reducedMotion && styles.sectionRevealVisible,
        reducedMotion && styles.sectionRevealReduced,
        className,
      )}
    >
      {children}
    </div>
  );
}
