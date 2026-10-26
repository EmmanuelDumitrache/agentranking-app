"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { DitheringShader } from "@/components/ui/dithering-shader";

const CONSTRAINED_VISUALS_QUERY =
  "(prefers-reduced-motion: reduce), (max-width: 767px)";

function subscribeToVisualPreference(onStoreChange: () => void): () => void {
  const media = window.matchMedia(CONSTRAINED_VISUALS_QUERY);
  media.addEventListener("change", onStoreChange);
  return () => media.removeEventListener("change", onStoreChange);
}

function shouldRenderWave(): boolean {
  return !window.matchMedia(CONSTRAINED_VISUALS_QUERY).matches;
}

export function DashboardMainWaveBackground() {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    () =>
      typeof window === "undefined"
        ? null
        : { width: window.innerWidth, height: window.innerHeight },
  );
  const renderWave = useSyncExternalStore(
    subscribeToVisualPreference,
    shouldRenderWave,
    () => false,
  );

  useEffect(() => {
    if (!renderWave) return;
    const updateSize = () => {
      setSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [renderWave]);

  if (!renderWave) {
    return null;
  }

  return (
    <div
      className="ui-main-wave-background pointer-events-none fixed inset-0 z-0"
      aria-hidden
    >
      {size && size.width > 0 ? (
        <DitheringShader
          width={size.width}
          height={size.height}
          shape="wave"
          type="8x8"
          colorBack="#000000"
          colorFront="#1a1a1a"
          pxSize={5}
          speed={0.5}
          className="!absolute inset-0 h-full w-full"
          style={{ width: "100%", height: "100%" }}
        />
      ) : null}
    </div>
  );
}
