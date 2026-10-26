"use client";
import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";
const EtherealShadow = dynamic(() => import("@/components/ui/ethereal-shadow"), { ssr: false });
function subscribeMobile(onStoreChange: () => void) {
  const mq = globalThis.matchMedia("(max-width: 767px)");
  mq.addEventListener("change", onStoreChange);
  return () => mq.removeEventListener("change", onStoreChange);
}
function getMobileSnapshot() {
  return globalThis.matchMedia("(max-width: 767px)").matches;
}
function getServerMobileSnapshot() {
  return false;
}
/** Ethereal public-site backdrop — CSS-only on mobile; gentle SVG drift on desktop. */
export function PublicSiteBackground() {
  const reduceMotion = useReducedMotion();
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, getServerMobileSnapshot);
  const lite = reduceMotion === true || isMobile;
  if (lite) {
    return (
      <>
        <div className="ar-public-bg-layer ar-public-bg-layer--static" aria-hidden />
        <div className="ar-public-bg-layer ar-public-bg-layer--ethereal-mask" aria-hidden />
      </>
    );
  }
  return (
    <>
      <div className="ar-public-bg-layer ar-public-bg-layer--static" aria-hidden />
      <div className="ar-public-bg-layer ar-public-bg-layer--ethereal-full" aria-hidden>
        <EtherealShadow
          color="rgba(165, 175, 195, 0.36)"
          animation={{ scale: 38, speed: 26 }}
          noise={{ opacity: 0.48, scale: 1.2 }}
          sizing="fill"
          className="h-full w-full"
        />
      </div>
    </>
  );
}
