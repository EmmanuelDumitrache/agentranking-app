import "server-only";
import { isTwitterAuthConfigured } from "@/lib/oauth-account-link";

export type AppAuthProviderAvailability = {
  twitter: boolean;
};

export function readAppAuthProviderAvailability(): AppAuthProviderAvailability {
  return { twitter: isTwitterAuthConfigured() };
}
