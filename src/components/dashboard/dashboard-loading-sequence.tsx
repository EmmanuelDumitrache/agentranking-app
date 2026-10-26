import Image from "next/image";
import { cn } from "@/lib/utils";

type Props = {
  readonly fullScreen?: boolean;
  readonly className?: string;
};

export function DashboardLoadingSequence({
  fullScreen = false,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "ui-ar-loading",
        fullScreen ? "ui-ar-loading--fullscreen" : "ui-ar-loading--inline",
        className,
      )}
      role="status"
      aria-live="polite"
      aria-label="Loading"
    >
      <div className="ui-ar-loading-mark" aria-hidden>
        <span className="ui-ar-loading-ring" />
        <Image
          src="/ar-mark.png"
          alt=""
          width={72}
          height={72}
          priority
          className="ui-ar-loading-logo"
        />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
