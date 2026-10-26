const PUMP_CREATE_LOG_MARKERS = ["Instruction: CreateV2", "Instruction: Create"];
/** Parse Pump create logs for the allocated mint account. */
export function extractMintFromPumpCreateLogs(logs: readonly string[]): string | null {
  for (const line of logs) {
    const allocateMatch =
      /Allocate: account Address \{ address: ([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(line);
    if (allocateMatch?.[1]) return allocateMatch[1];
  }
  return null;
}
export function isPumpCreateLogSet(logs: readonly string[]): boolean {
  return logs.some((line) => PUMP_CREATE_LOG_MARKERS.some((marker) => line.includes(marker)));
}