import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import styles from "./staking-dashboard.module.css";
export function StakingDashboardFrame({
  left,
  right,
  className,
}: {
  readonly left: ReactNode;
  readonly right: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn(styles.dashboardFrame, className)}>
      <div className={styles.dashboardGrid}>
        <div className={cn(styles.dashboardPanel, styles.dashboardPanelLeft)}>{left}</div>
        <div className={cn(styles.dashboardPanel, styles.dashboardPanelRight)}>{right}</div>
      </div>
    </div>
  );
}
