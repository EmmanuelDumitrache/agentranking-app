"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export function CompareRow({
  label,
  a,
  b,
  render,
}: {
  readonly label: string;
  readonly a: string | number | null;
  readonly b: string | number | null;
  render?: (val: string | number | null) => ReactNode;
}) {
  const aNum = typeof a === "number" ? a : null;
  const bNum = typeof b === "number" ? b : null;
  const aWins = aNum !== null && bNum !== null && aNum > bNum;
  const bWins = aNum !== null && bNum !== null && bNum > aNum;
  return (
    <tr className="compare-table-row">
      <td className="compare-table-dim-cell">{label}</td>
      <td className={cn("compare-table-value", aWins && "compare-table-value--win")}>
        {render ? render(a) : (a ?? "—")}
      </td>
      <td className={cn("compare-table-value", bWins && "compare-table-value--win")}>
        {render ? render(b) : (b ?? "—")}
      </td>
    </tr>
  );
}