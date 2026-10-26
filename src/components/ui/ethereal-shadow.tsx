"use client";
import {
  useRef,
  useId,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  animate,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "motion/react";
import { cn } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
const SHADOW_MASK_URL = "/textures/ethereal-shadow-mask.png";
const SHADOW_NOISE_URL = "/textures/ethereal-shadow-noise.png";
interface ResponsiveImage {
  src: string;
  alt?: string;
  srcSet?: string;
}
interface AnimationConfig {
  preview?: boolean;
  scale: number;
  speed: number;
}
interface NoiseConfig {
  opacity: number;
  scale: number;
}
export interface EtherealShadowProps {
  type?: "preset" | "custom";
  presetIndex?: number;
  customImage?: ResponsiveImage;
  sizing?: "fill" | "stretch";
  color?: string;
  animation?: AnimationConfig;
  noise?: NoiseConfig;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}
function mapRange(
  value: number,
  fromLow: number,
  fromHigh: number,
  toLow: number,
  toHigh: number,
): number {
  if (fromLow === fromHigh) {
    return toLow;
  }
  const percentage = (value - fromLow) / (fromHigh - fromLow);
  return toLow + percentage * (toHigh - toLow);
}
const useInstanceId = (): string => {
  const id = useId();
  const cleanId = id.replaceAll(":", "");
  return `shadowoverlay-${cleanId}`;
};
export function EtherealShadow({
  sizing = "fill",
  color = "rgba(128, 128, 128, 1)",
  animation,
  noise,
  style,
  className,
  children,
}: Readonly<EtherealShadowProps>) {
  const id = useInstanceId();
  const prefersReducedMotion = useReducedMotion();
  const liteBackground = useMediaQuery("(max-width: 767px)");
  const rootRef = useRef<HTMLDivElement>(null);
  const feColorMatrixRef = useRef<SVGFEColorMatrixElement>(null);
  const hueRotateMotionValue = useMotionValue(180);
  const hueRotateAnimation = useRef<AnimationPlaybackControls | null>(null);
  const animationEnabled =
    Boolean(animation && animation.scale > 0) && !prefersReducedMotion && !liteBackground;
  const displacementScale = animation
    ? mapRange(animation.scale, 1, 100, 20, 100)
    : 0;
  const animationDuration = animation
    ? mapRange(animation.speed, 1, 100, 1000, 50)
    : 1;
  useEffect(() => {
    if (feColorMatrixRef.current && animationEnabled && animation) {
      if (hueRotateAnimation.current) {
        hueRotateAnimation.current.stop();
      }
      hueRotateMotionValue.set(0);
      hueRotateAnimation.current = animate(hueRotateMotionValue, 360, {
        duration: animationDuration / 25,
        repeat: Infinity,
        repeatType: "loop",
        repeatDelay: 0,
        ease: "linear",
        delay: 0,
        onUpdate: (value: number) => {
          if (feColorMatrixRef.current) {
            feColorMatrixRef.current.setAttribute("values", String(value));
          }
        },
      });
      return () => {
        hueRotateAnimation.current?.stop();
      };
    }
  }, [animation, animationEnabled, animationDuration, hueRotateMotionValue]);
  useEffect(() => {
    if (!animationEnabled) return;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let inView = true;
    let scrollPaused = false;
    let pageVisible = !document.hidden;
    const syncPlayback = () => {
      const controls = hueRotateAnimation.current;
      if (!controls) return;
      if (inView && pageVisible && !scrollPaused) controls.play();
      else controls.pause();
    };
    const onScroll = () => {
      scrollPaused = true;
      syncPlayback();
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = undefined;
        scrollPaused = false;
        syncPlayback();
      }, 120);
    };
    const onVisibilityChange = () => {
      pageVisible = !document.hidden;
      syncPlayback();
    };
    const observer =
      typeof IntersectionObserver !== "undefined" && rootRef.current
        ? new IntersectionObserver(
            ([entry]) => {
              inView = entry?.isIntersecting ?? true;
              syncPlayback();
            },
            { rootMargin: "120px", threshold: 0.01 },
          )
        : null;
    if (rootRef.current) observer?.observe(rootRef.current);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    syncPlayback();
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      observer?.disconnect();
      if (idleTimer) clearTimeout(idleTimer);
      hueRotateAnimation.current?.pause();
    };
  }, [animationDuration, animationEnabled]);
  return (
    <div
      ref={rootRef}
      className={cn(className)}
      style={{
        overflow: "hidden",
        position: "relative",
        width: "100%",
        height: "100%",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -displacementScale,
          filter: animationEnabled ? `url(#${id}) blur(4px)` : "blur(14px)",
        }}
      >
        {animationEnabled && animation && (
          <svg style={{ position: "absolute" }} aria-hidden>
            <defs>
              <filter id={id}>
                <feTurbulence
                  result="undulation"
                  numOctaves="2"
                  baseFrequency={`${mapRange(animation.scale, 0, 100, 0.001, 0.0005)},${mapRange(animation.scale, 0, 100, 0.004, 0.002)}`}
                  seed="0"
                  type="turbulence"
                />
                <feColorMatrix
                  ref={feColorMatrixRef}
                  in="undulation"
                  type="hueRotate"
                  values="180"
                />
                <feColorMatrix
                  in="dist"
                  result="circulation"
                  type="matrix"
                  values="4 0 0 0 1  4 0 0 0 1  4 0 0 0 1  1 0 0 0 0"
                />
                <feDisplacementMap
                  in="SourceGraphic"
                  in2="circulation"
                  scale={displacementScale}
                  result="dist"
                />
                <feDisplacementMap
                  in="dist"
                  in2="undulation"
                  scale={displacementScale}
                  result="output"
                />
              </filter>
            </defs>
          </svg>
        )}
        <div
          style={{
            backgroundColor: color,
            WebkitMaskImage: `url('${SHADOW_MASK_URL}')`,
            maskImage: `url('${SHADOW_MASK_URL}')`,
            WebkitMaskSize: sizing === "stretch" ? "100% 100%" : "cover",
            maskSize: sizing === "stretch" ? "100% 100%" : "cover",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
            width: "100%",
            height: "100%",
          }}
        />
      </div>
      {children ? (
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          {children}
        </div>
      ) : null}
      {noise && noise.opacity > 0 ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${SHADOW_NOISE_URL}")`,
            backgroundSize: noise.scale * 200,
            backgroundRepeat: "repeat",
            opacity: noise.opacity / 2,
          }}
        />
      ) : null}
    </div>
  );
}
export default EtherealShadow;
