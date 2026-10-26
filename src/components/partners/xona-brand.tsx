import Image from "next/image";
import { cn } from "@/lib/utils";
export function XonaMark({
  size = 20,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/partners/xona/xona-mark.png"
      alt="Xona"
      width={size}
      height={size}
      className={cn("object-contain", className)}
    />
  );
}