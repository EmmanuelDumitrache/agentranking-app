"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { useMemo } from "react";
import { resolveImageUrl } from "@/lib/image-utils";
export interface SphereImageData {
  id: string;
  src: string;
  alt: string;
}
interface Props {
  images?: SphereImageData[];
  containerSize?: number;
}
interface OrbitConfig {
  radius: number;
  count: number;
  duration: number;
  size: number;
  reverse: boolean;
}
export default function SphereImageGrid({
  images = [],
  containerSize = 420,
}: Props) {
  const half = containerSize / 2;
  const orbits: OrbitConfig[] = useMemo(
    () => [
      { radius: half * 0.72, count: 10, duration: 28, size: 46, reverse: false },
      { radius: half * 0.54, count: 8, duration: 22, size: 40, reverse: true },
      { radius: half * 0.84, count: 6, duration: 34, size: 38, reverse: false },
    ],
    [half],
  );
  // Deduplicate images by src URL
  const unique = useMemo(() => {
    const seen = new Set<string>();
    const out: SphereImageData[] = [];
    for (const img of images) {
      const resolved = resolveImageUrl(img.src);
      if (!resolved || seen.has(resolved)) continue;
      seen.add(resolved);
      out.push({ ...img, src: resolved });
    }
    return out;
  }, [images]);
  const totalNeeded = orbits.reduce((s, o) => s + o.count, 0);
  const used = unique.slice(0, totalNeeded);
  if (used.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-full border border-dashed border-white/8"
        style={{ width: containerSize, height: containerSize }}
      >
        <p className="text-xs text-white/25">No agents indexed</p>
      </div>
    );
  }
  let imgIdx = 0;
  return (
    <>
      <style>{`
        @keyframes ar-rotate-ring {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes ar-rotate-ring-rev {
          from { transform: rotate(0deg); }
          to   { transform: rotate(-360deg); }
        }
        @keyframes ar-counter-rotate {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to   { transform: translate(-50%, -50%) rotate(-360deg); }
        }
        @keyframes ar-counter-rotate-rev {
          from { transform: translate(-50%, -50%) rotate(0deg); }
          to   { transform: translate(-50%, -50%) rotate(360deg); }
        }
      `}</style>
      <div
        className="relative overflow-hidden rounded-full"
        style={{ width: containerSize, height: containerSize }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at center, rgba(255,255,255,0.03) 0%, transparent 60%)",
          }}
        />
        {orbits.map((orbit, oi) => {
          const ringSize = orbit.radius * 2 + orbit.size;
          const avatarCount = Math.min(orbit.count, used.length - imgIdx);
          if (avatarCount <= 0) return null;
          const avatars: React.ReactNode[] = [];
          for (let i = 0; i < avatarCount; i++) {
            const img = used[imgIdx++];
            const angle = (360 / avatarCount) * i;
            const rad = (angle * Math.PI) / 180;
            const cx = Math.cos(rad) * orbit.radius;
            const cy = Math.sin(rad) * orbit.radius;
            const csrAnim = orbit.reverse ? "ar-counter-rotate-rev" : "ar-counter-rotate";
            avatars.push(
              <div
                key={img.id}
                className="absolute"
                style={{
                  width: orbit.size,
                  height: orbit.size,
                  left: `calc(50% + ${cx}px)`,
                  top: `calc(50% + ${cy}px)`,
                  transform: "translate(-50%, -50%)",
                  animation: `${csrAnim} ${orbit.duration}s linear infinite`,
                }}
              >
                <div className="relative h-full w-full overflow-hidden rounded-full border border-white/[0.14] bg-white/5 shadow-lg">
                  <RuntimeImage
                    src={img.src}
                    alt={img.alt}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                </div>
              </div>,
            );
          }
          return (
            <div
              key={oi}
              className="absolute"
              style={{
                width: ringSize,
                height: ringSize,
                left: `calc(50% - ${ringSize / 2}px)`,
                top: `calc(50% - ${ringSize / 2}px)`,
                animation: `${orbit.reverse ? "ar-rotate-ring-rev" : "ar-rotate-ring"} ${
                  orbit.duration
                }s linear infinite`,
              }}
            >
              {avatars}
            </div>
          );
        })}
        <RuntimeImage
          src="/ar-mark-3d.png"
          alt="AgentRanking"
          className="absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full object-contain"
        />
      </div>
    </>
  );
}
