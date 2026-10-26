export type ProgressCheckpoint = (progress: Record<string, unknown>) => Promise<void>;
export async function reportProgress(
  checkpoint: ProgressCheckpoint | undefined,
  progress: Record<string, unknown>,
): Promise<void> {
  if (checkpoint) await checkpoint(progress);
}
