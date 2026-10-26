"use client";
import { motion } from "motion/react";
import { BadgeCheck, Bot, Coins } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { publicSiteRoutes } from "@/lib/public-site/routes";
const RobotHeadMark = dynamic(
  () => import("@/components/ui/robot-head-mark").then((mod) => mod.RobotHeadMark),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-40 w-40 animate-pulse rounded-2xl bg-white/10 sm:h-48 sm:w-48"
        aria-hidden
      />
    ),
  },
);
const HERO_VIDEO_SRC =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4";
const WORDS = ["wallets.", "tokens.", "rank."] as const;
function CyclingHeadline() {
  const [word, setWord] = useState<(typeof WORDS)[number]>(WORDS[0]);
  const [opaque, setOpaque] = useState(true);
  const indexRef = useRef(0);
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const holdMs = reduceMotion ? 4000 : 2600;
    const fadeMs = reduceMotion ? 0 : 180;
    const id = window.setInterval(() => {
      setOpaque(false);
      window.setTimeout(() => {
        indexRef.current = (indexRef.current + 1) % WORDS.length;
        setWord(WORDS[indexRef.current]);
        setOpaque(true);
      }, fadeMs);
    }, holdMs);
    return () => window.clearInterval(id);
  }, []);
  return (
    <h1
      className="m-0 max-w-full whitespace-nowrap font-semibold text-white"
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        justifyContent: "center",
        gap: "0.22em",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: "clamp(36px, 4.5vw, 68px)",
        fontWeight: 650,
        lineHeight: 1,
        letterSpacing: "-0.04em",
        textShadow: "0 2px 28px rgba(0, 0, 0, 0.5)",
      }}
    >
      <span className="shrink-0">Agents with</span>
      <span
        className="shrink-0"
        style={{
          display: "inline-block",
          width: "3.55em",
          textAlign: "left",
          verticalAlign: "baseline",
        }}
      >
        <span
          className="inline-block whitespace-nowrap transition-opacity duration-200"
          style={{
            opacity: opaque ? 1 : 0,
          }}
        >
          {word}
        </span>
      </span>
    </h1>
  );
}
export function AgentRankingHero() {
  return (
    <section className="relative -mt-[53px] flex h-screen w-full items-center justify-center">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
        src={HERO_VIDEO_SRC}
      />
      <div className="noise-overlay pointer-events-none absolute inset-0 opacity-[0.7] mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-black/25 to-black/75" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent sm:h-28" />
      <div className="relative z-10 flex w-full flex-col items-center justify-center px-5 text-center sm:px-10">
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-center gap-1 sm:gap-1.5"
        >
          <RobotHeadMark className="robot-head-canvas h-40 w-40 sm:h-48 sm:w-48" />
          <CyclingHeadline />
        </motion.div>
        <motion.p
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.75, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 max-w-[42rem] font-medium leading-relaxed tracking-tight text-white/75 [text-shadow:0_1px_14px_rgba(0,0,0,0.45)] sm:mt-7"
          style={{ fontSize: "clamp(17px, 1.35vw, 23px)" }}
        >
          Launch, Tokenize and Verify Agents.
        </motion.p>
        <motion.div
          initial={{ y: 16, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.75, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mt-8 flex flex-wrap items-center justify-center gap-6 sm:mt-10 sm:gap-8"
        >
          <a
            href="#verification"
            className="ar-hero-text-cta group inline-flex items-center gap-2 text-[1.0625rem] font-semibold tracking-tight text-white transition-transform duration-200 ease-out hover:-translate-y-1"
          >
            <BadgeCheck className="h-4 w-4 shrink-0 opacity-90" />
            Verify Agent
          </a>
          <a
            href={publicSiteRoutes.launchAgent}
            className="ar-hero-text-cta group inline-flex items-center gap-2 text-[1.0625rem] font-semibold tracking-tight text-white transition-transform duration-200 ease-out hover:-translate-y-1"
          >
            <Bot className="h-4 w-4 shrink-0 opacity-90" />
            Launch Agent
          </a>
          <Link
            href={publicSiteRoutes.launchToken}
            className="ar-hero-text-cta group inline-flex items-center gap-2 text-[1.0625rem] font-semibold tracking-tight text-white transition-transform duration-200 ease-out hover:-translate-y-1"
          >
            <Coins className="h-4 w-4 shrink-0 opacity-90" />
            Token only
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
