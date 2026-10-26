import { cn } from "@/lib/utils";

type Props = {
  readonly children: React.ReactNode;
  readonly className?: string;
  readonly minWidthClassName?: string;
};

export function DashboardResponsiveTable({
  children,
  className,
  minWidthClassName = "min-w-[40rem]",
}: Props) {
  return (
    <div className={cn("ui-table-scroll", className)}>
      <div className={cn("ui-table-scroll-inner", minWidthClassName)}>{children}</div>
    </div>
  );
}
