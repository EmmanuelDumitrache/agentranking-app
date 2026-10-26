import Link from "next/link";
import { cn } from "@/lib/utils";
import type { PublicAgentCredential } from "@/lib/verification/public-agent-credential";

type Props = {
  readonly credential: PublicAgentCredential | null | undefined;
  readonly className?: string;
};

export function PublicCredentialChip({ credential, className }: Props) {
  if (!credential?.present) return null;
  return (
    <Link
      href={credential.proofPath}
      className={cn(
        "inline-flex max-w-full items-center rounded border border-border/60 bg-muted/30 px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide text-foreground/80 transition-colors hover:border-border hover:text-foreground",
        className,
      )}
      title="Public operator credential"
    >
      {credential.publicId}
    </Link>
  );
}
