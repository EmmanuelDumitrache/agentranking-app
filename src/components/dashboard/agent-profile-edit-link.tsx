import Link from "next/link";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  readonly agentDbId: number;
  readonly className?: string;
};

export function AgentProfileEditLink({ agentDbId, className }: Props) {
  return (
    <Link
      href={`/dashboard/agents/${agentDbId}/social`}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-[#212121] hover:text-foreground",
        className,
      )}
      aria-label="Edit agent profile"
      title="Edit profile & versions"
    >
      <Pencil className="size-4" aria-hidden />
    </Link>
  );
}
