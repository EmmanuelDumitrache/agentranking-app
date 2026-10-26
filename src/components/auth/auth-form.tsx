"use client";

import { RuntimeImage } from "@/components/shared/runtime-image";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type React from "react";
interface AuthAction {
  label: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  comingSoon?: boolean;
  /** Match the solid primary (Google) button look. Default true when not comingSoon. */
  matchPrimary?: boolean;
}
interface AuthFormProps extends React.HTMLAttributes<HTMLDivElement> {
  logoSrc: string;
  logoAlt?: string;
  title: string;
  description?: string;
  primaryAction: AuthAction;
  /** OAuth/social buttons shown directly under the primary action. */
  socialActions?: AuthAction[];
  /** Wallet buttons shown after an "or" divider. */
  walletActions?: AuthAction[];
  /** Email sign-in / sign-up block shown between social and wallet groups. */
  emailSection?: React.ReactNode;
  footerContent?: React.ReactNode;
}
const primaryButtonClass =
  "ui-auth-youtube__button ui-auth-youtube__button--primary flex h-11 w-full items-center justify-center gap-2.5 rounded-full bg-[#f1f1f1] text-sm font-medium text-[#0f0f0f] hover:bg-white disabled:bg-[#aaa] disabled:text-[#212121]";
const mutedButtonClass =
  "ui-auth-youtube__button ui-auth-youtube__button--secondary flex h-11 w-full items-center justify-center gap-2.5 rounded-full border border-[#303030] bg-[#212121] text-sm font-medium text-[#f1f1f1] hover:bg-[#303030]";
function AuthActionButton({ action }: { readonly action: AuthAction }) {
  const usePrimary = !action.comingSoon && action.matchPrimary !== false;
  return (
    <Button
      variant={usePrimary ? "default" : "secondary"}
      disabled={action.disabled || action.comingSoon || action.loading}
      onClick={action.onClick}
      className={usePrimary ? primaryButtonClass : mutedButtonClass}
    >
      {action.loading ? (
        <span
          className={cn(
            "h-4 w-4 animate-spin rounded-full border-2",
            usePrimary
              ? "border-[#aaa] border-t-[#0f0f0f]"
              : "border-[#555] border-t-[#f1f1f1]",
          )}
        />
      ) : (
        action.icon
      )}
      {action.label}
      {action.comingSoon ? (
        <span className="ml-1 text-[10px] text-[#aaa]">(coming soon)</span>
      ) : null}
    </Button>
  );
}
function AuthOrDivider() {
  return (
    <div className="ui-auth-youtube__divider relative py-0.5">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-[#303030]" />
      </div>
      <div className="relative flex justify-center text-xs uppercase">
        <span className="bg-[#181818] px-2 text-[#aaa]">or</span>
      </div>
    </div>
  );
}
const AuthForm = ({
  className,
  logoSrc,
  logoAlt = "Logo",
  title,
  description,
  primaryAction,
  socialActions,
  walletActions,
  emailSection,
  footerContent,
  ...props
}: AuthFormProps) => {
  const socialGroup = socialActions ?? [];
  const walletGroup = walletActions ?? [];
  return (
    <div className={cn("ui-auth-youtube w-full", className)} {...props}>
      <Card className="ui-auth-youtube__panel w-full rounded-xl border border-[#303030] bg-[#181818] shadow-none">
        <CardHeader className="pb-0 text-center">
          <div className="mb-4 flex justify-center">
            <RuntimeImage src={logoSrc} alt={logoAlt} className="h-10 w-10 rounded object-contain" />
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight text-[#f1f1f1]">
            {title}
          </CardTitle>
          {description ? (
            <CardDescription className="text-sm text-[#aaa]">{description}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-3 pt-6">
          <div className="grid gap-2">
            <AuthActionButton action={primaryAction} />
            {socialGroup.map((action) => (
              <AuthActionButton key={action.label} action={action} />
            ))}
          </div>
          {emailSection ? (
            <>
              <AuthOrDivider />
              {emailSection}
            </>
          ) : null}
          {walletGroup.length > 0 ? (
            <>
              <AuthOrDivider />
              <div className="grid gap-2">
                {walletGroup.map((action) => (
                  <AuthActionButton key={action.label} action={action} />
                ))}
              </div>
            </>
          ) : null}
        </CardContent>
        {footerContent ? (
          <CardFooter className="flex flex-col pt-0">{footerContent}</CardFooter>
        ) : null}
      </Card>
    </div>
  );
};
AuthForm.displayName = "AuthForm";
export { AuthForm };
