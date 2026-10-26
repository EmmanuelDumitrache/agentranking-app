"use client";
import { LazyDitheringShader } from "@/components/ui/lazy-dithering-shader";
import { useWindowDimensions } from "@/hooks/use-window-dimensions";
export function OnboardingWaveBackground() {
  const size = useWindowDimensions();
  if (size.width === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <LazyDitheringShader
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
    </div>
  );
}
