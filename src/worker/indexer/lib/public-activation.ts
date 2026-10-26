export type ModerationStatus = "inherit" | "blocked" | "disabled" | string;
export interface PublicActivationInput {
  sourceActive: boolean | null | undefined;
  moderationStatus: ModerationStatus | null | undefined;
  administrativeOverride: boolean | null | undefined;
  complete: boolean;
  lowSignal?: boolean;
}
/**
 * Derive public visibility from independently owned state. Registry/indexer
 * lifecycle, moderation, and an explicit administrative override must never be
 * collapsed into one sticky boolean because that prevents legitimate source
 * reactivation and lets synchronization overwrite operator decisions.
 */
export function derivePublicActivation(input: PublicActivationInput): boolean {
  const moderationAllows = input.moderationStatus !== "blocked" && input.moderationStatus !== "disabled";
  const administrativeAllows = input.administrativeOverride !== false;
  const sourceAllows = input.sourceActive !== false;
  return Boolean(sourceAllows && moderationAllows && administrativeAllows && input.complete && !input.lowSignal);
}
