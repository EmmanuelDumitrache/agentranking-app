"use client";
import { useState } from "react";
import Image from "next/image";
import { Carousel, CarouselApi, CarouselContent, CarouselItem } from "@/components/ui/carousel";
import { useVisibilityAwareInterval } from "@/hooks/use-visibility-aware-interval";
const PARTNERS = [
  { name: "Phantom", file: "phantom.png" },
  { name: "Metaplex", file: "metaplex.png" },
  { name: "Qwerti", file: "qwerti.png" },
  { name: "Streamflow", file: "streamflow.png" },
  { name: "Hatcher Labs", file: "hatcher-labs.png" },
  { name: "WURK", file: "wurk.png" },
  { name: "SAID", file: "said.png" },
  { name: "Hyre", file: "hyre.png" },
  { name: "OOBE", file: "oobe.png" },
  { name: "Xona", file: "xona.png" },
  { name: "Synapse", file: "synapse.png" },
  { name: "Medusa", file: "medusa.png" },
  { name: "Covenant", file: "covenant.png" },
  { name: "Acepyr", file: "acepyr.png" },
  { name: "EarnFi", file: "earnfi.png" },
] as const;
const LOGO_BASE = "/exports/partner-logos-256";
const SPEED_MS = 1800;
export function PartnerCarousel() {
  const [api, setApi] = useState<CarouselApi>();
  useVisibilityAwareInterval(() => api?.scrollNext(), SPEED_MS, { paused: !api });
  return (
    <section className="py-8">
      <div className="mx-auto">
        <p className="text-muted-foreground mb-4 text-center text-[11px] font-semibold uppercase tracking-[0.14em]">
          AR Partners
        </p>
        <Carousel
          setApi={setApi}
          opts={{ align: "start", loop: true, dragFree: true }}
          className="w-full"
        >
          <CarouselContent className="-ml-6">
            {PARTNERS.map((partner) => (
              <CarouselItem key={partner.name} className="basis-1/3 pl-6 sm:basis-1/4 md:basis-1/5 lg:basis-[14.28%]">
                <div className="flex items-center justify-center py-3">
                  <Image
                    src={`${LOGO_BASE}/${partner.file}`}
                    alt={partner.name}
                    width={128}
                    height={64}
                    className="h-10 w-auto rounded object-contain hover:opacity-80 transition-opacity"
                    unoptimized
                  />
                </div>
              </CarouselItem>
            ))}
          </CarouselContent>
        </Carousel>
      </div>
    </section>
  );
}
