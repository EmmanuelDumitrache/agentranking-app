import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BusinessVerificationBanner() {
  return (
    <div className="ui-overview-panel flex flex-col gap-3 overflow-hidden rounded-xl px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <Building2
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          strokeWidth={1.75}
          aria-hidden
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Upgrade to Business</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Business KYB, higher limits, program controls, and dedicated onboarding.
          </p>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" className="shrink-0" disabled>
        Contact sales · Coming soon
      </Button>
    </div>
  );
}
