export function resolveCreateAgentPageRedirect(input: {
  readonly profileId: number | null | undefined;
  readonly shouldShowOnboarding: boolean;
}): string | null {
  if (input.profileId && input.shouldShowOnboarding) {
    return "/onboarding";
  }
  return null;
}
