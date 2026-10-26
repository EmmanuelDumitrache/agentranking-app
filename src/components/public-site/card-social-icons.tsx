import type { ReactNode } from "react";
import { Globe } from "lucide-react";
import type { TokenCardSocials } from "@/lib/public-site/token-card-market";
import { tokenCardSocialsHaveAny } from "@/lib/public-site/token-card-market";
function TelegramIcon({ className }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.25-5.54 3.66-.52.36-1 .53-1.42.52-.47-.01-1.37-.26-2.03-.48-.82-.27-1.47-.42-1.41-.88.03-.24.37-.49 1.02-.74 3.98-1.73 6.63-2.87 7.96-3.43 3.79-1.58 4.58-1.85 5.09-1.86.11 0 .37.03.54.16.14.11.18.26.2.37.02.12.03.24.01.38z"
      />
    </svg>
  );
}
type Props = {
  readonly socials: TokenCardSocials;
  readonly className?: string;
};
/** Icon-only X / Telegram / Website links for public-site cards. */
export function CardSocialIcons({ socials, className = "absolute top-2.5 right-2.5 z-10" }: Props) {
  if (!tokenCardSocialsHaveAny(socials)) return null;
  const items: { href: string; label: string; icon: ReactNode }[] = [];
  if (socials.twitter) {
    items.push({
      href: socials.twitter,
      label: "X",
      icon: <span className="text-[11px] font-semibold leading-none" aria-hidden>𝕏</span>,
    });
  }
  if (socials.telegram) {
    items.push({
      href: socials.telegram,
      label: "Telegram",
      icon: <TelegramIcon className="size-3.5" />,
    });
  }
  if (socials.website) {
    items.push({
      href: socials.website,
      label: "Website",
      icon: <Globe className="size-3.5" />,
    });
  }
  return (
    <div className={`${className} flex items-center gap-1`}>
      {items.map((item) => (
        <a
          key={`${item.label}-${item.href}`}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={item.label}
          title={item.label}
          onClick={(event) => event.stopPropagation()}
          className="text-muted-foreground hover:text-foreground inline-flex size-6 items-center justify-center transition-colors"
        >
          {item.icon}
        </a>
      ))}
    </div>
  );
}
