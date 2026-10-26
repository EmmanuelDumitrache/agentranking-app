export type MetaplexLastIndexError = {
  assetAddress: string;
  message: string;
  at: string;
};
let lastIndexError: MetaplexLastIndexError | null = null;
export function recordMetaplexIndexFailure(assetAddress: string, message: string): void {
  lastIndexError = {
    assetAddress: assetAddress.trim(),
    message: message.trim() || "Indexing failed",
    at: new Date().toISOString(),
  };
}
export function clearMetaplexIndexError(): void {
  lastIndexError = null;
}
export function getMetaplexLastIndexError(): MetaplexLastIndexError | null {
  return lastIndexError;
}