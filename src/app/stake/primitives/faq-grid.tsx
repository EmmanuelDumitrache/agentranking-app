import styles from "@/app/stake/styles/stake-content.module.css";
import { cn } from "@/lib/utils";
export function FAQGrid({
  items,
}: {
  readonly items: readonly { readonly q: string; readonly a: string }[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.q} className={cn("rounded-xl p-5", styles.premiumCard)}>
          <h3 className="font-semibold text-foreground">{item.q}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
        </div>
      ))}
    </div>
  );
}
