"use client";

import Image from "next/image";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import styles from "@/components/public-site/mcp-connector.module.css";

function Slab({
  className,
  floatClass,
  kicker,
  title,
  detail,
}: {
  readonly className: string;
  readonly floatClass: string;
  readonly kicker: string;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <div className={cn(styles.slab, className, floatClass)}>
      <div className={styles.slabFace}>
        <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
          {kicker}
        </p>
        <p className="mt-1.5 m-0 text-[13px] font-semibold tracking-tight text-white">{title}</p>
        <p className="mt-1 m-0 text-[11px] leading-snug text-white/50">{detail}</p>
      </div>
    </div>
  );
}

export function McpFlowDiagram() {
  const reduceMotion = useReducedMotion();
  return (
    <div className={styles.scene} role="img" aria-label="Diagram: AI client connects through one MCP URL to the AgentRanking registry">
      <div className={cn(styles.stage, !reduceMotion && styles.stageLive)}>
        <svg className={styles.pathSvg} viewBox="0 0 400 220" fill="none" aria-hidden>
          <path
            d="M 70 150 C 150 80, 230 70, 330 150"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="1.5"
            strokeDasharray="5 7"
          />
          {!reduceMotion ? (
            <circle r="3.5" fill="#f3f3f5">
              <animateMotion
                dur="3.4s"
                repeatCount="indefinite"
                path="M 70 150 C 150 80, 230 70, 330 150"
              />
            </circle>
          ) : null}
        </svg>
        <Slab
          className={styles.slabClient}
          floatClass={!reduceMotion ? styles.floatA : ""}
          kicker="Client"
          title="Claude · Cursor"
          detail="Asks in English. Presses tools."
        />
        <div className={cn(styles.slab, styles.slabMcp, !reduceMotion && styles.floatB)}>
          <div className={styles.slabFace}>
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
              Connector
            </p>
            <p className="mt-1.5 m-0 font-mono text-[12px] font-semibold tracking-tight text-white">
              /api/mcp
            </p>
            <p className="mt-1 m-0 text-[11px] leading-snug text-white/50">
              One URL. No key.
            </p>
          </div>
        </div>
        <div className={cn(styles.slab, styles.slabRegistry, !reduceMotion && styles.floatC)}>
          <div className={cn(styles.slabFace, "flex items-start gap-2.5")}>
            <Image
              src="/ar-mark.png"
              alt=""
              width={28}
              height={28}
              className="mt-0.5 h-7 w-7 shrink-0 object-contain"
              aria-hidden
            />
            <div>
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                Registry
              </p>
              <p className="mt-1.5 m-0 text-[13px] font-semibold tracking-tight text-white">
                AgentRanking
              </p>
              <p className="mt-1 m-0 text-[11px] leading-snug text-white/50">
                Rank, trust, AR-ID
              </p>
            </div>
          </div>
        </div>
        <span className={cn(styles.chip, styles.chipA)}>search_agents</span>
        <span className={cn(styles.chip, styles.chipB)}>AR-ID</span>
        <span className={cn(styles.chip, styles.chipC)}>FairScale</span>
      </div>
    </div>
  );
}
