"use client";

import dynamic from "next/dynamic";
import type { ComponentProps, ComponentType } from "react";
import type DitheringShaderDefault from "@/components/ui/dithering-shader";

type DitheringShaderProps = ComponentProps<typeof DitheringShaderDefault>;

function DitheringFallback(_props: DitheringShaderProps) {
  return null;
}

/**
 * Lazy WebGL wave — never crash the page if the chunk times out (common under
 * HTTPS webpack HMR when the shader bundle is still compiling).
 */
export const LazyDitheringShader: ComponentType<DitheringShaderProps> = dynamic(
  () =>
    import("@/components/ui/dithering-shader")
      .then((mod) => mod.default ?? mod.DitheringShader)
      .catch(() => DitheringFallback),
  { ssr: false, loading: () => null },
);
