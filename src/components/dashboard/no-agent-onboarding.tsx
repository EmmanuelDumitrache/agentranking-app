import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DashboardNoAgentOnboarding() {
  return (
    <div className="ui-onboarding-youtube ui-page-stack ui-page-stack--narrow mx-auto flex w-full flex-col items-center gap-6 py-16 text-center text-[#f1f1f1]">
      <header className="ui-page-header w-full border-none pb-0">
        <div className="mx-auto min-w-0">
          <h1 className="ui-page-title">Launch your first agent</h1>
          <p className="ui-page-subtitle mx-auto">
            Agent identity comes first. Tokenization is optional and attaches to an agent later.
          </p>
        </div>
      </header>
      <Button asChild size="lg" className="ui-onboarding-youtube__button rounded-full bg-[#f1f1f1] text-[#0f0f0f] hover:bg-white gap-2">
        <Link href="/dashboard/agents/new">
          <Plus className="h-4 w-4" aria-hidden />
          Create agent
        </Link>
      </Button>
      <p className="max-w-md text-xs leading-relaxed text-[#aaa]">
        The full workspace menu is always visible. After your first agent is created, select it in
        the sidebar to open Overview, Token, Wallet, Verification, and the rest.
      </p>
    </div>
  );
}
