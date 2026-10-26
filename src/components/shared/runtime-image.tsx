import type { ComponentPropsWithoutRef } from "react";

/**
 * Native image element for runtime-controlled sources that cannot be safely
 * enumerated in Next.js image remotePatterns, or for UI marks that require
 * native image event/fallback semantics.
 */
type RuntimeImageProps = Omit<ComponentPropsWithoutRef<"img">, "alt"> & {
  alt: string;
};

export function RuntimeImage({ alt, ...props }: RuntimeImageProps) {
  // eslint-disable-next-line @next/next/no-img-element -- intentional native-image boundary for runtime-controlled sources
  return <img alt={alt} {...props} />;
}
